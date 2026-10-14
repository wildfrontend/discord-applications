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
  mock.method(console, 'warn', () => {})
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

test('calculates shared configuration before AI and can answer with one text-only request', async () => {
  const w = wikiFixture()
  w.wiki.callTool = async (name, args) => {
    w.calls.push([name, args])
    return {
      content: [],
      structuredContent: {
        result: {
          final: { hp: 1780, atk: 100, spd: 150 },
          derived: { defUnit: { flat: 10, pct: 0 } },
        },
        runes: [
          {
            id: 'r09',
            name: '堅硬的皮膚I',
            sourceUrl: 'https://wiki.example.test/r09',
          },
        ],
        sourceUrl: 'https://wiki.example.test/panel',
        warnings: ['Not a battle simulation'],
      },
    }
  }
  let requests = 0
  const result = await answerConsultation(
    {
      text: '幫我看 https://dino-mutant-wiki.vercel.app/#v=2&hp=1780&atk=100&spd=150&s=r09.5.1&chpp=27',
      images: [],
    },
    {
      config,
      connect: w.connect,
      request: async (_url, init) => {
        requests++
        assert.equal(w.calls[0]?.[0], 'simulate_loadout')
        assert.deepEqual(w.calls[0]?.[1], {
          base: { hp: 1780, atk: 100, spd: 150 },
          slots: [{ runeId: 'r09', level: 5, active: true }],
          bonuses: [{ source: '星座', stat: 'hp', mode: 'pct', value: 0.27 }],
        })
        const body = JSON.parse(init?.body as string)
        assert.ok(
          body.messages.every(
            (message: { content: unknown }) =>
              typeof message.content === 'string',
          ),
        )
        assert.match(body.messages.at(-1).content, /堅硬的皮膚I/)
        assert.match(body.messages.at(-1).content, /Not a battle simulation/)
        assert.doesNotMatch(body.messages.at(-1).content, /#v=2/)
        return aiResponse('單位減傷為 10。')
      },
    },
  )
  assert.equal(requests, 1)
  assert.match(result, /https:\/\/wiki.example.test\/panel/)
  assert.equal(w.closed(), 1)
})

test('missing shared inputs skip automatic simulation and follow-ups reuse the latest share', async () => {
  const w = wikiFixture()
  await answerConsultation(
    {
      text: '有什麼缺少的？',
      images: [],
      history: [
        {
          question: 'https://dino-mutant-wiki.vercel.app/#s=r09.5',
          answer: '請補素質',
        },
      ],
    },
    {
      config,
      connect: w.connect,
      request: async (_url, init) => {
        const body = JSON.parse(init?.body as string)
        assert.match(
          body.messages.at(-1).content,
          /Missing base stats or condition toggles/,
        )
        assert.match(body.messages.at(-1).content, /r09/)
        assert.match(body.messages.at(-1).content, /有什麼缺少的/)
        assert.doesNotMatch(JSON.stringify(body.messages), /#s=r09/)
        return aiResponse('請提供素質與條件。')
      },
    },
  )
  assert.equal(w.calls.length, 0)
})

test('invalid shares never reach the AI provider or Wiki', async () => {
  let calls = 0
  await assert.rejects(
    answerConsultation(
      { text: 'https://dino-mutant-wiki.vercel.app/#hp=NaN', images: [] },
      {
        config,
        connect: async () => {
          calls++
          throw new Error('unexpected')
        },
        request: async () => {
          calls++
          return aiResponse('unexpected')
        },
      },
    ),
    /格式不正確/,
  )
  assert.equal(calls, 0)
})

test('inventory name lookup only exposes listed IDs rather than the whole Wiki catalog', async () => {
  const w = wikiFixture()
  w.wiki.callTool = async (name, args) => {
    w.calls.push([name, args])
    return {
      content: [],
      structuredContent: {
        items: [
          {
            id: 'r09',
            name: '堅硬的皮膚I',
            scope: '通用',
            sourceUrl: 'https://wiki.example.test/r09',
          },
          {
            id: 'r99',
            name: 'Unowned catalog entry',
            sourceUrl: 'https://wiki.example.test/unowned',
          },
        ],
      },
    }
  }
  const answer = await answerConsultation(
    {
      text: '我能換哪個？ https://dino-mutant-wiki.vercel.app/inventory#inv=r09.5',
      images: [],
    },
    {
      config,
      connect: w.connect,
      request: async (_url, init) => {
        const body = JSON.parse(init?.body as string)
        assert.match(body.messages.at(-1).content, /堅硬的皮膚I/)
        assert.doesNotMatch(
          body.messages.at(-1).content,
          /Unowned catalog entry|r99/,
        )
        return aiResponse('目前提供堅硬的皮膚I 5 級。')
      },
    },
  )
  assert.deepEqual(w.calls, [['search_runes', { limit: 100 }]])
  assert.doesNotMatch(answer, /unowned/)
})

test('preloads exact current-level effects for a small inventory and removes duplicate rune metadata', async () => {
  const w = wikiFixture()
  w.wiki.tools.push({ name: 'get_rune', inputSchema: { type: 'object' } })
  w.wiki.callTool = async (name, args) => {
    w.calls.push([name, args])
    return {
      content: [],
      structuredContent:
        name === 'get_rune'
          ? {
              rune: { id: 'r34', name: '屏障' },
              level: 2,
              item: {
                rune: { name: 'duplicate metadata' },
                value1: 0.18,
                upgradeToNextDust: null,
              },
              effectSpec: {
                effects: [{ stat: 'hp', mode: 'pct', from: 'v1' }],
              },
              warnings: ['null is unknown'],
              sourceUrl: 'https://wiki.example.test/r34',
            }
          : { items: [] },
    }
  }
  await answerConsultation(
    {
      text: 'https://dino-mutant-wiki.vercel.app/inventory#inv=r34.2',
      images: [],
    },
    {
      config,
      connect: w.connect,
      request: async (_url, init) => {
        const body = JSON.parse(init?.body as string)
        const evidence = body.messages.at(-1).content
        assert.match(evidence, /"value1":0.18/)
        assert.match(evidence, /"stat":"hp"/)
        assert.match(evidence, /"upgradeToNextDust":null/)
        assert.match(evidence, /null is unknown/)
        assert.doesNotMatch(evidence, /duplicate metadata/)
        return aiResponse('屏障 2 級為生命 +18%。')
      },
    },
  )
  assert.deepEqual(w.calls, [
    ['search_runes', { limit: 100 }],
    ['get_rune', { id: 'r34', level: 2 }],
  ])
})

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
        if (requests.length === 1) {
          assert.equal(body.tools, undefined)
          assert.equal(body.response_format.type, 'json_object')
          return aiResponse(
            JSON.stringify({
              images: [
                {
                  index: 1,
                  runes: ['生命符文 5 級'],
                  stats: 'unknown',
                  uncertain: 'none',
                },
              ],
            }),
          )
        }
        return requests.length === 2
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
    requests[1].messages.some((message) => message.content === '我無課'),
  )
  assert.ok(
    requests
      .slice(1)
      .every((request) =>
        request.messages.every(
          (message) =>
            typeof message.content === 'string' || message.content === null,
        ),
      ),
  )
  assert.ok(
    !JSON.stringify(requests.slice(1)).includes(
      'https://cdn.discordapp.com/image.png',
    ),
  )
  assert.ok(JSON.stringify(requests[1]).includes('生命符文 5 級'))
  const result = requests[2].messages.at(-1)
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
  for (const status of [400, 401, 403, 413, 429, 500]) {
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
  const progress: string[] = []
  const answer = await answerConsultation(
    { text: '問題', images: [] },
    {
      config,
      connect: w.connect,
      pause: async (milliseconds) => {
        waits.push(milliseconds)
      },
      onProgress: async (text) => {
        progress.push(text)
      },
      request: async () => {
        requests++
        if (requests === 1) return aiResponse(null, [toolCall()])
        if (requests === 2)
          return new Response('', {
            status: 429,
            headers: { 'retry-after': '45' },
          })
        return aiResponse('診斷完成。')
      },
    },
  )
  assert.match(answer, /診斷完成/)
  assert.deepEqual(waits, [45000])
  assert.ok(progress.some((text) => text.includes('45 秒')))
  assert.equal(w.calls.length, 1)
  assert.equal(w.closed(), 1)
})

test('oversized Wiki results request a narrower query instead of filling AI context', async () => {
  const w = wikiFixture()
  w.wiki.callTool = async () => ({
    content: [],
    structuredContent: { values: 'x'.repeat(10000) },
  })
  let requests = 0
  await answerConsultation(
    { text: '查詢符文', images: [] },
    {
      config,
      connect: w.connect,
      request: async (_url, init) => {
        if (++requests === 1) return aiResponse(null, [toolCall()])
        const body = JSON.parse(init?.body as string)
        assert.match(body.messages.at(-1).content, /narrower range/)
        assert.ok(body.messages.at(-1).content.length < 6000)
        return aiResponse('請指定符文等級。')
      },
    },
  )
  assert.equal(w.closed(), 1)
})

test('limits tool loops, handles truncated answers and validates images before connecting', async () => {
  const w = wikiFixture()
  const truncated = await answerConsultation(
    { text: '問題', images: [] },
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

test('three screenshots are read once without tools, history or a full diagnosis prompt', async () => {
  const w = wikiFixture()
  let requests = 0
  const images = [
    'https://cdn.discordapp.com/1.png',
    'https://cdn.discordapp.com/2.png',
    'https://cdn.discordapp.com/3.png',
  ]
  await answerConsultation(
    {
      text: '請建議 PVP 配置',
      images,
      history: [
        { question: '先前问题'.repeat(500), answer: '先前回答'.repeat(500) },
      ],
    },
    {
      config,
      connect: w.connect,
      request: async (_url, init) => {
        const body = JSON.parse(init?.body as string)
        if (++requests === 1) {
          assert.equal(body.tools, undefined)
          assert.equal(body.messages.length, 2)
          assert.ok(body.messages[0].content.length < 700)
          assert.equal(
            body.messages[1].content.filter(
              (part: { type: string }) => part.type === 'image_url',
            ).length,
            3,
          )
          return aiResponse(
            JSON.stringify({
              images: images.map((_, index) => ({
                index: index + 1,
                runes: ['橘色皇冠 5 級'],
                stats: 'unknown',
                uncertain: 'name unreadable',
              })),
            }),
          )
        }
        assert.ok(!JSON.stringify(body).includes('image_url'))
        assert.ok(JSON.stringify(body).includes('name unreadable'))
        return aiResponse('需要確認符文名稱。')
      },
    },
  )
  assert.equal(requests, 2)
  assert.equal(w.closed(), 1)
})

test('truncated or malformed screenshot observations stop before Wiki queries', async () => {
  for (const content of [
    'invalid JSON',
    'null',
    '[]',
    '{}',
    '{"images":[]}',
    '{"images":[{"index":1}]}',
  ]) {
    await assert.rejects(
      answerConsultation(
        { text: '圖片', images: ['https://example.test/image.png'] },
        {
          config,
          connect: async () => {
            throw new Error('must not connect')
          },
          request: async () => aiResponse(content),
        },
      ),
      /圖片辨識/,
    )
  }
  await assert.rejects(
    answerConsultation(
      { text: '圖片', images: ['https://example.test/image.png'] },
      {
        config,
        connect: async () => {
          throw new Error('must not connect')
        },
        request: async () => aiResponse('{', undefined, 'length'),
      },
    ),
    /尚未完整/,
  )
})

test('oversized requests report capacity rather than a broken API key', async () => {
  await assert.rejects(
    answerConsultation(
      { text: '圖片', images: ['https://example.test/image.png'] },
      {
        config,
        request: async () =>
          new Response('secret upstream detail', { status: 413 }),
      },
    ),
    (error: unknown) =>
      error instanceof ConsultationError &&
      /單次容量/.test(error.message) &&
      !error.message.includes('secret upstream detail'),
  )
})

test('image diagnosis stops querying after two rounds and summarizes confirmed results', async () => {
  const w = wikiFixture()
  let requests = 0
  await answerConsultation(
    { text: 'PVP 配置', images: ['https://example.test/image.png'] },
    {
      config,
      connect: w.connect,
      request: async (_url, init) => {
        const body = JSON.parse(init?.body as string)
        requests++
        if (requests === 1)
          return aiResponse(
            JSON.stringify({
              images: [
                {
                  index: 1,
                  runes: ['unknown icon'],
                  stats: 'unknown',
                  uncertain: 'name unreadable',
                },
              ],
            }),
          )
        if (requests <= 3) return aiResponse(null, [toolCall()])
        assert.equal(body.tool_choice, 'none')
        assert.ok(!JSON.stringify(body).includes('image_url'))
        return aiResponse('已有資料與尚需確認的項目。')
      },
    },
  )
  assert.equal(requests, 4)
  assert.equal(w.calls.length, 2)
})

test('exhausting the Wiki query budget still permits a final answer with missing data', async () => {
  const w = wikiFixture()
  let requests = 0
  const answer = await answerConsultation(
    { text: '配裝', images: [] },
    {
      config,
      connect: w.connect,
      request: async (_url, init) => {
        if (++requests === 1)
          return aiResponse(
            null,
            Array.from({ length: 13 }, (_, index) => ({
              ...toolCall(),
              id: `call-${index}`,
            })),
          )
        const body = JSON.parse(init?.body as string)
        assert.equal(body.tool_choice, 'none')
        assert.match(body.messages.at(-1).content, /budget is exhausted/)
        return aiResponse('已確認的資料如下；其他資料仍待補充。')
      },
    },
  )
  assert.match(answer, /待補充/)
  assert.equal(w.calls.length, 12)
})

async function featureFixture(
  answerOverride?: (question: ConsultationQuestion) => Promise<string>,
) {
  const guildId = `guild-${++counter}`
  const channelId = `channel-${counter}`
  await consultationChannelStore.set(guildId, channelId, 'admin')
  let listener: (message: Message) => Promise<void>
  let updateListener: (before: Message, after: Message) => Promise<void>
  const requests: ConsultationQuestion[] = []
  const replies: Array<{ content: string; allowedMentions: unknown }> = []
  const posted: Array<(typeof replies)[number]> = []
  const edits: Array<(typeof replies)[number]> = []
  let messageCounter = 0
  let lostStatus = false
  let fail = false
  const client = {
    user: { id: '123' },
    on(event: string, callback: typeof listener) {
      if (event === Events.MessageCreate) listener = callback
      if (event === Events.MessageUpdate)
        updateListener = callback as unknown as typeof updateListener
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
    posted,
    edits,
    loseStatus() {
      lostStatus = true
    },
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
        id?: string
        previousContent?: string
      } = {},
    ) {
      const message = {
        id: options.id ?? `${channelId}-message-${++messageCounter}`,
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
        reply: async (payload: (typeof replies)[number]) => {
          const entry = { ...payload }
          replies.push(entry)
          posted.push({ ...payload })
          return {
            async edit(update: (typeof replies)[number]) {
              if (lostStatus) throw new Error('Status message deleted')
              Object.assign(entry, update)
              edits.push({ ...update })
            },
            async delete() {
              const index = replies.indexOf(entry)
              if (index !== -1) replies.splice(index, 1)
            },
          }
        },
      } as unknown as Message
      if (options.previousContent !== undefined) {
        await updateListener(
          { ...message, content: options.previousContent } as Message,
          message,
        )
      } else await listener(message)
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

test('invalid share links get instructions without consuming quota or cooldown', async () => {
  const f = await featureFixture()
  const user = `invalid-share-${counter}`
  await f.send('<@123> https://dino-mutant-wiki.vercel.app/', { user })
  await f.send('<@123> https://dino-mutant-wiki.vercel.app/#s=r09.99.1', {
    user,
  })
  assert.equal(f.requests.length, 0)
  assert.equal(
    (await consultationUsageStore.get(consultationDay(now), user)).user,
    0,
  )
  assert.match(f.replies[0].content, /按「分享」/)
  await f.send(
    '<@123> https://dino-mutant-wiki.vercel.app/#hp=1780&atk=100&spd=150&s=r09.5.1',
    { user },
  )
  assert.equal(f.requests.length, 1)
  assert.equal(
    (await consultationUsageStore.get(consultationDay(now), user)).user,
    1,
  )
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
  assert.match(f.posted[0].content, /正在思考/)
  assert.equal(f.edits.length, 1)
  assert.ok(!f.replies[0].content.includes('正在思考'))
  await f.send('<@123> 問題')
  assert.equal(f.requests.length, 1)
  assert.match(f.replies.at(-1)?.content ?? '', /再等/)
})

test('posts a thinking status before AI starts and replaces it with the result', async () => {
  const f = await featureFixture(async () => {
    assert.match(f.replies[0].content, /正在思考並查詢 Wiki/)
    return '完整診斷結果。'
  })
  await f.send('<@123> 問題', { user: 'status-user' })
  assert.equal(f.posted.length, 1)
  assert.equal(f.edits.length, 1)
  assert.match(f.replies[0].content, /完整診斷結果/)
  assert.ok(!f.replies[0].content.includes('正在思考'))
  assert.deepEqual(f.posted[0].allowedMentions, {
    parse: [],
    repliedUser: false,
  })
})

test('delivers the answer as a new reply when the thinking status was deleted', async () => {
  const f = await featureFixture(async () => '診斷結果。')
  f.loseStatus()
  await f.send('<@123> 問題', { user: 'deleted-status-user' })
  assert.equal(f.posted.length, 2)
  assert.equal(f.replies.length, 1)
  assert.match(f.replies[0].content, /診斷結果/)
})

test('first mention added by editing triggers once, while later edits do not consume quota', async () => {
  const f = await featureFixture()
  const options = { user: 'edit-user', id: 'edited-question' }
  await f.send('普通問題', options)
  await f.send('<@123> 普通問題', { ...options, previousContent: '普通問題' })
  assert.equal(f.requests.length, 1)
  now += 61_000
  await f.send('<@123> 改了問題', {
    ...options,
    previousContent: '<@123> 普通問題',
  })
  await f.send('<@123> 普通問題', options)
  assert.equal(f.requests.length, 1)
  assert.equal(
    (await consultationUsageStore.get(consultationDay(now), 'edit-user')).user,
    1,
  )
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
