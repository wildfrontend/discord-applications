import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, mock, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  type Attachment,
  type Client,
  Collection,
  Events,
  type Message,
  PermissionFlagsBits,
} from 'discord.js'
import {
  consultationConfig,
  consultationDay,
  consultationLimits,
} from '../src/consultation/config.js'
import type { WikiSession } from '../src/consultation/mcp.js'
import {
  answerConsultation,
  ConsultationError,
  type ConsultationQuestion,
} from '../src/consultation/service.js'

const directory = mkdtempSync(join(tmpdir(), 'dc-consultation-'))
process.env.BOT_DATA_DIR = directory
process.env.DATABASE_DRIVER = 'sqlite'
delete process.env.DATABASE_URL
const { consultationChannelStore, consultationUsageStore } = await import(
  '../src/consultation/store.js'
)
const { startConsultationFeature } = await import(
  '../src/consultation/feature.js'
)
const { default: command } = await import('../src/commands/rune-dr.js')
const { closeDatabases } = await import('../src/database.js')
let now = 1_800_000_000_000
let counter = 0

beforeEach(() => {
  mock.restoreAll()
  process.env.CONSULTATION_ENABLED = 'true'
  process.env.AI_API_KEY = 'translation-test-key'
  process.env.AI_WIKI_KEY = 'wiki-test-key'
  delete process.env.CONSULTATION_AI_API_KEY
  delete process.env.CONSULTATION_AI_MODEL
  delete process.env.CONSULTATION_AI_BASE_URL
  now = 1_800_000_000_000
  mock.method(Date, 'now', () => now)
  mock.method(console, 'log', () => {})
})
after(() => {
  mock.restoreAll()
  closeDatabases()
  rmSync(directory, { recursive: true, force: true })
})

const config = {
  enabled: true,
  apiKey: 'test-secret',
  baseUrl: 'https://api.example.test/v1',
  model: 'vision-model',
  mcpUrl: 'https://wiki.example.test/mcp',
}
function aiResponse(
  content: string | null,
  tool_calls?: unknown[],
  finish_reason = 'stop',
) {
  return new Response(
    JSON.stringify({
      choices: [
        { finish_reason, message: { role: 'assistant', content, tool_calls } },
      ],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
function toolCall(name = 'search_runes', args = '{}') {
  return {
    id: `call-${name}`,
    type: 'function',
    function: { name, arguments: args },
  }
}
function wikiFixture() {
  const calls: Array<[string, Record<string, unknown>]> = []
  let closed = 0
  const wiki: WikiSession = {
    tools: [
      {
        name: 'search_runes',
        description: 'Search runes',
        inputSchema: { type: 'object' },
      },
    ],
    instructions: 'Do not invent missing rune stats.',
    async callTool(name, args) {
      calls.push([name, args])
      return {
        content: [],
        structuredContent: {
          sourceUrl: 'https://wiki.example.test/runes',
          warnings: ['Snapshot'],
          items: [{ name: 'Rune', value: null }],
        },
      }
    },
    async close() {
      closed++
    },
  }
  return { wiki, calls, closed: () => closed, connect: async () => wiki }
}

test('consultation prefers AI_WIKI_KEY and supports independent provider settings', () => {
  assert.equal(consultationConfig().apiKey, 'wiki-test-key')
  process.env.CONSULTATION_AI_API_KEY = 'separate-key'
  process.env.CONSULTATION_AI_MODEL = 'different-model'
  process.env.CONSULTATION_AI_BASE_URL = 'https://different.example/v1/'
  assert.equal(consultationConfig().apiKey, 'separate-key')
  assert.equal(consultationConfig().model, 'different-model')
  assert.equal(consultationConfig().baseUrl, 'https://different.example/v1')
  delete process.env.CONSULTATION_AI_API_KEY
  delete process.env.AI_WIKI_KEY
  assert.equal(consultationConfig().apiKey, 'translation-test-key')
})

test('sends image inputs and executes MCP calls before replying with sources', async () => {
  const w = wikiFixture()
  const requests: Array<{
    messages: Array<{
      role: string
      content: string | Array<{ type: string; image_url?: { url: string } }>
    }>
  }> = []
  const answer = await answerConsultation(
    {
      text: '這個符文如何？',
      images: ['https://cdn.discordapp.com/image.png'],
      history: [{ question: '我無課', answer: '請提供符文等級' }],
    },
    {
      config,
      connect: w.connect,
      request: async (url, init) => {
        assert.equal(url, `${config.baseUrl}/chat/completions`)
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          'Bearer test-secret',
        )
        const body = JSON.parse(init?.body as string)
        requests.push(body)
        return requests.length === 1
          ? aiResponse(null, [
              toolCall('search_runes', '{"query":"生命","limit":2}'),
            ])
          : aiResponse('這是 Wiki 的查詢結果。')
      },
    },
  )
  assert.deepEqual(w.calls, [['search_runes', { query: '生命', limit: 2 }]])
  assert.equal(w.closed(), 1)
  assert.match(answer, /https:\/\/wiki.example.test\/runes/)
  const user = requests[0].messages.at(-1)
  assert.ok(user && Array.isArray(user.content))
  assert.equal(user.content[1].type, 'image_url')
  assert.equal(
    user.content[1].image_url?.url,
    'https://cdn.discordapp.com/image.png',
  )
  assert.ok(
    requests[0].messages.some((message) => message.content === '我無課'),
  )
  const result = requests[1].messages.at(-1)
  assert.ok(result && typeof result.content === 'string')
  assert.equal(result.role, 'tool')
  assert.equal(
    JSON.parse(result.content).structuredContent.items[0].value,
    null,
  )
})

test('rejects unknown tools and invalid tool arguments without executing them', async () => {
  for (const call of [
    toolCall('delete_everything'),
    toolCall('search_runes', '[]'),
    toolCall('search_runes', '{bad'),
  ]) {
    const w = wikiFixture()
    let requests = 0
    await answerConsultation(
      { text: '查詢符文', images: [] },
      {
        config,
        connect: w.connect,
        request: async (_url, init) => {
          if (++requests === 1) return aiResponse(null, [call])
          const body = JSON.parse(init?.body as string)
          assert.match(body.messages.at(-1).content, /failed/)
          return aiResponse('請提供正確的資料。')
        },
      },
    )
    assert.equal(w.calls.length, 0)
    assert.equal(w.closed(), 1)
  }
})

test('handles provider errors without exposing response secrets and always closes MCP', async () => {
  for (const status of [401, 429, 500]) {
    const w = wikiFixture()
    await assert.rejects(
      answerConsultation(
        { text: '問題', images: [] },
        {
          config,
          connect: w.connect,
          request: async () =>
            new Response('private-provider-detail test-secret', { status }),
        },
      ),
      (error: unknown) =>
        error instanceof ConsultationError &&
        !error.message.includes('test-secret') &&
        !error.message.includes('private-provider-detail'),
    )
    assert.equal(w.closed(), 1)
  }
})

test('retries short Groq rate limits using Retry-After without repeating MCP calls', async () => {
  const w = wikiFixture()
  let requests = 0
  const waits: number[] = []
  const answer = await answerConsultation(
    { text: '問題', images: [] },
    {
      config,
      connect: w.connect,
      pause: async (milliseconds) => {
        waits.push(milliseconds)
      },
      request: async () => {
        requests++
        if (requests === 1) return aiResponse(null, [toolCall()])
        if (requests === 2)
          return new Response('', {
            status: 429,
            headers: { 'retry-after': '26' },
          })
        return aiResponse('診斷完成。')
      },
    },
  )
  assert.match(answer, /診斷完成/)
  assert.deepEqual(waits, [26000])
  assert.equal(w.calls.length, 1)
  assert.equal(w.closed(), 1)
})

test('limits tool loops, handles truncated answers and validates images before connecting', async () => {
  const w = wikiFixture()
  const truncated = await answerConsultation(
    { text: '', images: ['https://example.test/image.png'] },
    {
      config,
      connect: w.connect,
      request: async () =>
        aiResponse('<think>internal</think>診斷內容', undefined, 'length'),
    },
  )
  assert.match(truncated, /診斷內容/)
  assert.match(truncated, /長度上限/)
  assert.ok(!truncated.includes('internal'))
  await assert.rejects(
    answerConsultation(
      { text: '', images: ['1', '2', '3', '4'] },
      {
        config,
        connect: async () => {
          throw new Error('must not connect')
        },
      },
    ),
    /最多/,
  )
  let requests = 0
  await assert.rejects(
    answerConsultation(
      { text: '問題', images: [] },
      {
        config,
        connect: w.connect,
        request: async (_url, init) => {
          const body = JSON.parse(init?.body as string)
          if (++requests === 7) assert.equal(body.tool_choice, 'none')
          return aiResponse(null, [toolCall()])
        },
      },
    ),
    /暫時無法/,
  )
  assert.equal(requests, 7)
})

async function featureFixture(
  answerOverride?: (question: ConsultationQuestion) => Promise<string>,
) {
  const guildId = `guild-${++counter}`
  const channelId = `channel-${counter}`
  await consultationChannelStore.set(guildId, channelId, 'admin')
  let listener: (message: Message) => Promise<void>
  const requests: ConsultationQuestion[] = []
  const replies: Array<{ content: string; allowedMentions: unknown }> = []
  let fail = false
  const client = {
    user: { id: '123' },
    on(event: string, callback: typeof listener) {
      if (event === Events.MessageCreate) listener = callback
    },
  } as unknown as Client
  startConsultationFeature(client, async (question) => {
    requests.push(question)
    if (fail) throw new Error('secret-error')
    if (answerOverride) return answerOverride(question)
    return '診斷答案。'.repeat(600)
  })
  return {
    guildId,
    channelId,
    requests,
    replies,
    fail() {
      fail = true
    },
    async send(
      content: string,
      options: {
        user?: string
        channel?: string
        bot?: boolean
        webhook?: boolean
        files?: Attachment[]
        mentions?: boolean
      } = {},
    ) {
      await listener({
        content,
        guildId,
        channelId: options.channel ?? channelId,
        inGuild: () => true,
        author: { id: options.user ?? 'alice', bot: options.bot ?? false },
        webhookId: options.webhook ? 'webhook' : null,
        mentions: {
          users: new Collection(
            options.mentions === false ? [] : [['123', {}]],
          ),
        },
        attachments: new Collection(
          (options.files ?? []).map((file, index) => [`${index}`, file]),
        ),
        channel: { sendTyping: async () => {} },
        reply: async (payload: (typeof replies)[number]) =>
          replies.push(payload),
      } as unknown as Message)
    },
  }
}
function image(type = 'image/png', size = 100): Attachment {
  return {
    name: type === 'image/png' ? 'screen.png' : 'document.pdf',
    contentType: type,
    size,
    url: 'https://cdn.discordapp.com/screen.png',
  } as Attachment
}

test('only answers explicit mentions in enabled channels and avoids bot/webhook loops', async () => {
  const f = await featureFixture()
  await f.send('沒有提及 Bot')
  await f.send('回覆 Bot，但沒有明確 @')
  await f.send('<@123> 問題', { channel: 'unconfigured' })
  await f.send('<@123> 問題', { bot: true })
  await f.send('<@123> 問題', { webhook: true })
  await f.send('<@123> 問題', { mentions: false })
  assert.equal(f.requests.length, 0)
  await f.send('<@!123> 問題')
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].text, '問題')
  assert.equal(
    f.replies.map((reply) => reply.content).join(''),
    `🩺 **dr.大暴龍｜符文診斷**\n${'診斷答案。'.repeat(600)}`,
  )
  assert.ok(f.replies.every((reply) => reply.content.length <= 2000))
  assert.deepEqual(f.replies[0].allowedMentions, {
    parse: [],
    repliedUser: false,
  })
})

test('accepts image-only questions and rejects unsupported or excessive attachments before AI', async () => {
  const f = await featureFixture()
  await f.send('<@123>', { files: [image('application/pdf')] })
  await f.send('<@123> 問題', { files: [image(), image(), image(), image()] })
  await f.send('<@123> 問題', { files: [image('image/png', 21 * 1024 * 1024)] })
  assert.equal(f.requests.length, 0)
  await f.send('<@123>', { files: [image()] })
  assert.equal(f.requests[0].text, '')
  assert.deepEqual(f.requests[0].images, [
    'https://cdn.discordapp.com/screen.png',
  ])
})

test('keeps follow-up context private to each member and expires it after 20 minutes', async () => {
  const f = await featureFixture()
  await f.send('<@123> 我的生命白值是 1000')
  await f.send('<@123> 我的生命白值是 2000', { user: 'bob' })
  assert.equal(f.requests[1].history?.length, 0)
  now += 61_000
  await f.send('<@123> 怎麼配裝？')
  assert.equal(f.requests[2].history?.[0].question, '我的生命白值是 1000')
  assert.ok(!JSON.stringify(f.requests[2].history).includes('2000'))
  now += 21 * 60_000
  await f.send('<@123> 還記得嗎？')
  assert.equal(f.requests[3].history?.length, 0)
})

test('throttles repeated questions and does not expose unexpected errors', async () => {
  const f = await featureFixture()
  f.fail()
  await f.send('<@123> 問題')
  assert.ok(!f.replies[0].content.includes('secret-error'))
  await f.send('<@123> 問題')
  assert.equal(f.requests.length, 1)
  assert.match(f.replies.at(-1)?.content ?? '', /再等/)
})

test('daily quota enforces member and bot limits with one atomic reservation', async () => {
  const day = '2099-01-01'
  assert.equal(
    await consultationUsageStore.claim(day, 'quota-alice', 2, 3),
    true,
  )
  assert.equal(
    await consultationUsageStore.claim(day, 'quota-alice', 2, 3),
    true,
  )
  assert.equal(
    await consultationUsageStore.claim(day, 'quota-alice', 2, 3),
    false,
  )
  assert.equal(await consultationUsageStore.claim(day, 'quota-bob', 2, 3), true)
  assert.equal(
    await consultationUsageStore.claim(day, 'quota-carol', 2, 3),
    false,
  )
  assert.deepEqual(await consultationUsageStore.get(day, 'quota-alice'), {
    user: 2,
    bot: 3,
  })
  assert.equal(
    await consultationUsageStore.claim('2099-01-02', 'quota-alice', 2, 3),
    true,
  )
  assert.deepEqual(
    await consultationUsageStore.get('2099-01-02', 'quota-alice'),
    { user: 1, bot: 1 },
  )
})

test('concurrent claims cannot exceed the shared daily budget', async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      consultationUsageStore.claim('2099-01-03', `concurrent-${i}`, 2, 5),
    ),
  )
  assert.equal(results.filter(Boolean).length, 5)
  assert.equal(
    (await consultationUsageStore.get('2099-01-03', 'concurrent-0')).bot,
    5,
  )
})

test('daily quota resets at Taiwan midnight and defaults to the agreed limits', () => {
  assert.equal(
    consultationDay(Date.parse('2026-10-14T15:59:59Z')),
    '2026-10-14',
  )
  assert.equal(
    consultationDay(Date.parse('2026-10-14T16:00:00Z')),
    '2026-10-15',
  )
  assert.deepEqual(consultationLimits(), {
    cooldownSeconds: 60,
    userDaily: 10,
    botDaily: 100,
    concurrency: 1,
  })
})

test('daily counts persist when read from a fresh process', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    const {consultationUsageStore} = await import('./src/consultation/store.ts');
    const {closeDatabases} = await import('./src/database.ts');
    console.log(JSON.stringify(await consultationUsageStore.get('2099-01-01', 'quota-alice')));
    closeDatabases();
  `,
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...process.env,
        BOT_DATA_DIR: directory,
        DATABASE_DRIVER: 'sqlite',
      },
    },
  )
  assert.deepEqual(JSON.parse(output.trim()), { user: 2, bot: 3 })
})

test('busy and duplicate questions do not consume daily quota', async () => {
  let release: (value: string) => void = () => {
    throw new Error('Pending answer not initialized')
  }
  const pending = new Promise<string>((resolve) => {
    release = resolve
  })
  const f = await featureFixture(async () => pending)
  const first = f.send('<@123> 問題', { user: 'busy-first' })
  for (let i = 0; i < 100 && f.requests.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(f.requests.length, 1)
  await f.send('<@123> 第二題', { user: 'busy-first' })
  await f.send('<@123> 另一個人的問題', { user: 'busy-second' })
  assert.equal(f.requests.length, 1)
  assert.equal(
    (await consultationUsageStore.get(consultationDay(now), 'busy-first')).user,
    1,
  )
  assert.equal(
    (await consultationUsageStore.get(consultationDay(now), 'busy-second'))
      .user,
    0,
  )
  release('完成診斷。')
  await first
})

test('clinic commands require Manage Channels and persist open/close settings', async () => {
  for (const permitted of [false, true]) {
    const guildId = `command-guild-${++counter}`
    const channelId = `command-channel-${counter}`
    const replies: string[] = []
    let subcommand = 'open'
    const channel = {
      id: channelId,
      type: 0,
      permissionsFor: () => ({ has: () => true }),
    }
    const interaction = {
      inCachedGuild: () => true,
      guildId,
      user: { id: 'admin' },
      channel,
      guild: { members: { me: {} }, channels: { fetch: async () => channel } },
      memberPermissions: {
        has: (permission: bigint) =>
          permission === PermissionFlagsBits.ManageChannels && permitted,
      },
      options: { getSubcommand: () => subcommand, getChannel: () => null },
      reply: async (payload: { content: string }) =>
        replies.push(payload.content),
      deferReply: async () => {},
      editReply: async (content: string) => replies.push(content),
    }
    await command.execute(interaction as never)
    assert.equal(
      await consultationChannelStore.has(guildId, channelId),
      permitted,
    )
    if (!permitted) assert.match(replies[0], /管理頻道/)
    else {
      assert.match(replies[0], /dr.大暴龍.*開診/)
      subcommand = 'status'
      await command.execute(interaction as never)
      assert.match(replies[1], /只有 @Bot/)
      assert.ok(!replies[1].includes('wiki-test-key'))
      subcommand = 'close'
      await command.execute(interaction as never)
      assert.equal(
        await consultationChannelStore.has(guildId, channelId),
        false,
      )
      assert.match(replies[2], /休診/)
    }
  }
  assert.equal(command.data.name, 'rune-dr')
})
