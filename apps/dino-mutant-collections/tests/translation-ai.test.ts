import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, type TestContext, test } from 'node:test'
import { setImmediate } from 'node:timers/promises'

process.env.AI_API_KEY = 'test-only'
process.env.AI_MIN_REQUEST_INTERVAL_MS = '0'
process.env.AI_MAX_OUTPUT_TOKENS = '8192'

const { aiTranslationClient } = await import('../src/translation/ai-client.js')
const { enqueueAiRequest } = await import('../src/ai/request-queue.js')
const { retryAfterMs } = await import('../src/ai/retry.js')
let clock = 1_800_000_000_000

beforeEach((t) => {
  clock += 10_000_000
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: clock })
  mock.method(console, 'warn', () => {})
})
afterEach(() => mock.restoreAll())

function completion(value: unknown, finishReason = 'stop'): Response {
  return Response.json({
    choices: [
      {
        finish_reason: finishReason,
        message: { content: JSON.stringify(value) },
      },
    ],
  })
}

const valid = {
  translations: { en: 'Hello', ja: 'こんにちは' },
  detectedLanguage: 'zt',
}

// Advance only fake time; no network calls or real retry delays in these tests.
async function settle<T>(t: TestContext, request: Promise<T>): Promise<T> {
  let settled = false
  const observed = request.finally(() => {
    settled = true
  })
  void observed.catch(() => {})
  for (let step = 0; step < 20 && !settled; step++) {
    await setImmediate()
    if (!settled) t.mock.timers.tick(60_000)
  }
  assert.ok(settled, 'AI request did not settle')
  return observed
}

test('retries temporary HTTP failures and network timeouts without losing the translation', async (t) => {
  for (const status of [408, 409, 429, 500, 503, 'network', 'timeout']) {
    let attempts = 0
    const fetch = mock.method(globalThis, 'fetch', async () => {
      if (++attempts === 1) {
        if (status === 'network') throw new TypeError('fetch failed')
        if (status === 'timeout')
          throw new DOMException('timed out', 'TimeoutError')
        return new Response('unavailable', { status: status as number })
      }
      return completion(valid)
    })
    const result = await settle(t, aiTranslationClient.translate('你好', 'en'))
    assert.equal(result.text, 'Hello')
    assert.equal(fetch.mock.callCount(), 2)
    fetch.mock.restore()
  }
})

test('observes Retry-After for retries and other queued requests', async (t) => {
  const calls: number[] = []
  mock.method(globalThis, 'fetch', async () => {
    calls.push(Date.now())
    return calls.length === 1
      ? new Response('', { status: 429, headers: { 'Retry-After': '5' } })
      : completion(valid)
  })
  const request = aiTranslationClient.translate('你好', 'en')
  const sibling = enqueueAiRequest(async () => Date.now())
  await setImmediate()
  assert.equal(calls.length, 1)
  t.mock.timers.tick(4_999)
  await setImmediate()
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  await settle(t, request)
  assert.ok((await sibling) >= calls[0] + 5_000)
  assert.ok(calls[1] >= calls[0] + 5_000)
})

test('stops after three attempts and keeps the queue usable for later messages', async (t) => {
  const fetch = mock.method(
    globalThis,
    'fetch',
    async () => new Response('', { status: 503 }),
  )
  await assert.rejects(
    settle(t, aiTranslationClient.translate('你好', 'en')),
    /HTTP 503/,
  )
  assert.equal(fetch.mock.callCount(), 3)
  fetch.mock.restore()
  mock.method(globalThis, 'fetch', async () => completion(valid))
  assert.equal(
    (await settle(t, aiTranslationClient.translate('下一則', 'en'))).text,
    'Hello',
  )
})

test('does not retry permanent HTTP failures or long quota cooldowns', async (t) => {
  for (const status of [400, 401, 403, 404, 429]) {
    const fetch = mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response('', {
          status,
          headers: { 'Retry-After': '3600' },
        }),
    )
    await assert.rejects(
      settle(t, aiTranslationClient.translate('你好', 'en')),
      new RegExp(`HTTP ${status}`),
    )
    assert.equal(fetch.mock.callCount(), 1)
    fetch.mock.restore()
  }
})

test('retries malformed JSON, empty output, and missing or invalid target translations', async (t) => {
  const invalidResponses = [
    () => new Response('not JSON'),
    () => Response.json({ choices: [{ message: { content: '{broken' } }] }),
    () => Response.json({ choices: [] }),
    () => completion(null),
    () => completion({ translations: null, detectedLanguage: 'zt' }),
    () => completion({ translations: { en: 'Hello' }, detectedLanguage: 'zt' }),
    () =>
      completion({
        translations: { en: 42, ja: 'こんにちは' },
        detectedLanguage: 'zt',
      }),
    () =>
      completion({ translations: valid.translations, detectedLanguage: null }),
  ]
  for (const invalid of invalidResponses) {
    let attempts = 0
    const fetch = mock.method(globalThis, 'fetch', async () =>
      ++attempts === 1 ? invalid() : completion(valid),
    )
    const result = await settle(
      t,
      aiTranslationClient.translateMany('你好', ['en', 'ja']),
    )
    assert.deepEqual(result.translations, valid.translations)
    assert.equal(fetch.mock.callCount(), 2)
    fetch.mock.restore()
  }
})

test('increases the budget after truncation and never accepts a partial response', async (t) => {
  const budgets: number[] = []
  mock.method(globalThis, 'fetch', async (_url, options) => {
    budgets.push(JSON.parse(options?.body as string).max_tokens)
    return completion(valid, budgets.length < 3 ? 'length' : 'stop')
  })
  const result = await settle(t, aiTranslationClient.translate('你好', 'en'))
  assert.equal(result.text, 'Hello')
  assert.deepEqual(budgets, [900, 1800, 3600])
})

test('allocates more output space for long multilingual messages and respects the ceiling', async (t) => {
  const budgets: number[] = []
  mock.method(globalThis, 'fetch', async (_url, options) => {
    budgets.push(JSON.parse(options?.body as string).max_tokens)
    return completion(valid)
  })
  await settle(
    t,
    aiTranslationClient.translateMany('完整訊息'.repeat(200), ['en', 'ja']),
  )
  await settle(
    t,
    aiTranslationClient.translateMany('完整訊息'.repeat(2000), ['en', 'ja']),
  )
  assert.ok(budgets[0] > 900)
  assert.equal(budgets[1], 8192)
})

test('does not retry a truncated response when already at the configured ceiling', async (t) => {
  const fetch = mock.method(globalThis, 'fetch', async () =>
    completion(valid, 'length'),
  )
  await assert.rejects(
    settle(t, aiTranslationClient.translate('完整訊息'.repeat(2000), 'en')),
    /譯文未完成/,
  )
  assert.equal(fetch.mock.callCount(), 1)
})

test('retries invalid language detection and accepts unknown as a valid result', async (t) => {
  let attempts = 0
  mock.method(globalThis, 'fetch', async () =>
    completion(++attempts === 1 ? { language: 42 } : { language: 'unknown' }),
  )
  assert.deepEqual(await settle(t, aiTranslationClient.detect('123')), {
    language: null,
    confidence: 0,
  })
  assert.equal(attempts, 2)
})

test('parses Retry-After seconds, dates, and invalid values', () => {
  assert.equal(retryAfterMs('2.5'), 2500)
  assert.equal(retryAfterMs(new Date(Date.now() + 5_000).toUTCString()), 5000)
  assert.equal(retryAfterMs('invalid'), 0)
  assert.equal(retryAfterMs('-1'), 0)
  assert.equal(retryAfterMs(null), 0)
})
