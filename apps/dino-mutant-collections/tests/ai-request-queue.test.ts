import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { setImmediate } from 'node:timers/promises'

process.env.AI_MIN_REQUEST_INTERVAL_MS = ''
const { deferAiRequests, enqueueAiRequest } = await import(
  '../src/ai/request-queue.js'
)
const { RetryableAiError, requestAiWithRetry } = await import(
  '../src/ai/retry.js'
)
let clock = 1_800_000_000_000

beforeEach((t) => {
  clock += 1_000_000
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: clock })
  t.mock.method(console, 'warn', () => {})
})

test('an empty interval setting retains the default provider pacing', async (t) => {
  const first = enqueueAiRequest(async () => Date.now())
  const second = enqueueAiRequest(async () => Date.now())
  await setImmediate()
  t.mock.timers.tick(2_099)
  await setImmediate()
  t.mock.timers.tick(1)
  assert.equal((await second) - (await first), 2_100)
})

test('retry attempts also obey the minimum provider interval', async (t) => {
  const calls: number[] = []
  const request = requestAiWithRetry(async () => {
    calls.push(Date.now())
    if (calls.length === 1) throw new RetryableAiError('Temporary failure')
    return 'translated'
  })
  await setImmediate()
  t.mock.timers.tick(1_000)
  await setImmediate()
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1_100)
  assert.equal(await request, 'translated')
  assert.equal(calls[1] - calls[0], 2_100)
})

test('a cooldown extension also delays a request that is already waiting', async (t) => {
  await enqueueAiRequest(async () => {})
  let dispatched = false
  const request = enqueueAiRequest(async () => {
    dispatched = true
  })
  await setImmediate()
  t.mock.timers.tick(1_000)
  deferAiRequests(5_000)
  t.mock.timers.tick(1_100)
  await setImmediate()
  assert.equal(dispatched, false)
  t.mock.timers.tick(3_900)
  await request
  assert.equal(dispatched, true)
})
