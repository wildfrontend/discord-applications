import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, mock, test } from 'node:test'
import {
  type Attachment,
  AttachmentBuilder,
  type Client,
  Collection,
  Events,
  type Message,
} from 'discord.js'
import {
  type TranslationPayload,
  translationAttachment,
  translationPayloads,
} from '../src/translation/message-payload.js'

const dataDirectory = mkdtempSync(join(tmpdir(), 'dc-translation-forwarding-'))
process.env.BOT_DATA_DIR = dataDirectory
process.env.DATABASE_DRIVER = 'sqlite'
process.env.AI_API_KEY = 'test-only'
delete process.env.DATABASE_URL

const { aiTranslationClient } = await import('../src/translation/ai-client.js')
const { startTranslationFeature } = await import(
  '../src/translation/feature.js'
)
const { shouldTranslateMessage } = await import('../src/translation/service.js')
const { translationChannelLinkStore, translationGroupStore } = await import(
  '../src/translation/store.js'
)
const { default: translateCommand } = await import(
  '../src/commands/translate.js'
)
const { closeDatabases } = await import('../src/database.js')
let counter = 0

beforeEach(() => {
  mock.restoreAll()
  for (const method of ['detect', 'translate', 'translateMany'] as const) {
    mock.method(aiTranslationClient, method, async () => {
      throw new Error(`Unexpected AI call: ${method}`)
    })
  }
  mock.method(console, 'log', () => {})
})
after(() => {
  mock.restoreAll()
  closeDatabases()
  rmSync(dataDirectory, { recursive: true, force: true })
})

function attachment(name = 'SPOILER_photo.png'): Attachment {
  return {
    id: name,
    url: `https://cdn.discordapp.com/attachments/1/2/${name}?signed=value`,
    name,
    description: 'Original image description',
    spoiler: name.startsWith('SPOILER_'),
  } as Attachment
}

async function fixture(group = false) {
  const id = `forward-${++counter}`
  const sourceId = `${id}-source`
  const targetIds = group ? [`${id}-en`, `${id}-ja`] : [`${id}-en`]
  const sent: Array<{
    channelId: string
    via: 'webhook' | 'bot'
    payload: TranslationPayload & { username?: string; avatarURL?: string }
  }> = []
  let attempts = 0
  let failAt = 0
  const channels = new Map(
    targetIds.map((channelId) => {
      const webhook = {
        name: 'Dino 翻譯',
        owner: { id: 'bot' },
        isIncoming: () => true,
        async send(payload: (typeof sent)[number]['payload']) {
          attempts++
          if (attempts === failAt) throw new Error('Webhook unavailable')
          sent.push({ channelId, via: 'webhook', payload })
        },
      }
      return [
        channelId,
        {
          id: channelId,
          type: 0,
          permissionsFor: () => ({ has: () => true }),
          fetchWebhooks: async () => new Collection([['webhook', webhook]]),
          async send(payload: TranslationPayload) {
            sent.push({ channelId, via: 'bot', payload })
          },
        },
      ] as const
    }),
  )
  let onMessage: (message: Message) => Promise<void>
  const client = {
    user: { id: 'bot' },
    on(event: string, callback: typeof onMessage) {
      if (event === Events.MessageCreate) onMessage = callback
    },
  } as unknown as Client
  startTranslationFeature(client, { automatic: true })
  if (group) {
    await translationGroupStore.replace(
      id,
      `${id}-category`,
      [
        { channelId: sourceId, language: 'zt' },
        { channelId: targetIds[0], language: 'en' },
        { channelId: targetIds[1], language: 'ja' },
      ],
      'author',
    )
  } else {
    await translationChannelLinkStore.set(
      id,
      sourceId,
      'zt',
      targetIds[0],
      'en',
      'author',
    )
  }
  return {
    client,
    sent,
    targetIds,
    channel: channels.get(targetIds[0]),
    failAt(attempt: number) {
      failAt = attempt
    },
    async forward(content: string, files: Attachment[] = [], bot = false) {
      await onMessage({
        content,
        channelId: sourceId,
        url: `https://discord.com/channels/${id}/${sourceId}/message`,
        inGuild: () => true,
        author: { bot, displayName: 'Author' },
        member: {
          displayName: 'Nickname',
          displayAvatarURL: () => 'https://example.com/avatar.png',
        },
        attachments: new Collection(files.map((file) => [file.id, file])),
        guild: { channels: { fetch: async (id: string) => channels.get(id) } },
        client,
      } as unknown as Message)
    },
  }
}

test('forwards link-only and attachment-only messages in links and groups without AI', async () => {
  for (const group of [false, true]) {
    const f = await fixture(group)
    const links = 'https://example.com/a\n<https://example.com/b>'
    assert.equal(shouldTranslateMessage(links), false)
    await f.forward(links)
    await f.forward('', [attachment()])
    assert.equal(f.sent.length, f.targetIds.length * 2)
    for (const targetId of f.targetIds) {
      const messages = f.sent.filter((entry) => entry.channelId === targetId)
      assert.ok(messages[0].payload.content?.startsWith(links))
      assert.equal(messages[1].payload.files?.[0].name, 'SPOILER_photo.png')
      assert.equal(messages[1].payload.files?.[0].spoiler, true)
      assert.equal(
        messages[1].payload.files?.[0].description,
        'Original image description',
      )
      assert.equal(messages[1].payload.files?.[0].attachment, attachment().url)
      assert.equal(messages[1].payload.username, 'Nickname')
      assert.equal(
        messages[1].payload.avatarURL,
        'https://example.com/avatar.png',
      )
    }
  }
})

test('translates text while forwarding all images and files unchanged to every target', async () => {
  const f = await fixture(true)
  const input = '大家看看 https://example.com/article'
  const translate = mock.method(
    aiTranslationClient,
    'translateMany',
    async (text, targets) => {
      assert.equal(text, input)
      assert.deepEqual(targets, ['en', 'ja'])
      return {
        detectedLanguage: 'zt' as const,
        translations: {
          en: 'Look https://example.com/article',
          ja: '見て https://example.com/article',
        },
      }
    },
  )
  await f.forward(input, [attachment(), attachment('document.pdf')])
  assert.equal(translate.mock.callCount(), 1)
  assert.equal(f.sent.length, 2)
  for (const entry of f.sent) {
    assert.match(entry.payload.content ?? '', /https:\/\/example.com\/article/)
    assert.equal(entry.payload.files?.length, 2)
    assert.equal(
      entry.payload.files?.[1].attachment,
      attachment('document.pdf').url,
    )
  }
})

test('splits long translations without losing text or repeating attachments', async () => {
  const f = await fixture()
  const text = 'Complete translation 🌏\n'.repeat(250)
  mock.method(aiTranslationClient, 'translate', async () => ({
    text,
    detectedLanguage: 'zt',
  }))
  await f.forward('完整的內容', [attachment()])
  assert.ok(f.sent.length > 1)
  const fullText = f.sent.map((entry) => entry.payload.content).join('')
  assert.ok(fullText.startsWith(`${text}\n-# [查看原訊息](`))
  assert.ok(
    f.sent.every((entry) => (entry.payload.content?.length ?? 0) <= 2000),
  )
  assert.equal(f.sent.filter((entry) => entry.payload.files?.length).length, 1)
})

test('fallback preserves files and does not resend earlier successful chunks', async () => {
  const f = await fixture()
  mock.method(console, 'warn', () => {})
  f.failAt(1)
  await f.forward('', [attachment()])
  assert.equal(f.sent[0].via, 'bot')
  assert.equal(f.sent[0].payload.files?.[0].spoiler, true)

  f.sent.length = 0
  f.failAt(3)
  const text = '長'.repeat(4500)
  mock.method(aiTranslationClient, 'translate', async () => ({
    text,
    detectedLanguage: 'zt',
  }))
  await f.forward('完整的內容', [attachment()])
  assert.equal(f.sent[0].via, 'webhook')
  assert.equal(f.sent.filter((entry) => entry.payload.files?.length).length, 1)
  assert.equal(
    f.sent
      .map((entry) => entry.payload.content)
      .join('')
      .match(/長/g)?.length,
    4500,
  )
})

test('skips empty and bot messages and forwards code-only messages without AI', async () => {
  const f = await fixture()
  await f.forward('')
  await f.forward('https://example.com', [], true)
  assert.equal(f.sent.length, 0)
  await f.forward('```\nconst value = 1\n```')
  assert.ok(f.sent[0].payload.content?.startsWith('```\nconst value = 1\n```'))
})

test('payload splitting preserves Unicode and batches attachments within Discord limits', () => {
  const text = `${'a'.repeat(1999)}🌏${'b'.repeat(2200)}`
  const files = Array.from(
    { length: 12 },
    (_, i) => new AttachmentBuilder(Buffer.from(`${i}`), { name: `${i}.txt` }),
  )
  const payloads = translationPayloads(text, files)
  assert.equal(payloads.map((payload) => payload.content ?? '').join(''), text)
  assert.ok(payloads.every((payload) => (payload.content?.length ?? 0) <= 2000))
  assert.ok(
    payloads.every(
      (payload) => !/[\uD800-\uDBFF]$/.test(payload.content ?? ''),
    ),
  )
  assert.deepEqual(
    payloads.flatMap((payload) => payload.files ?? []),
    files,
  )
  assert.ok(payloads.every((payload) => (payload.files?.length ?? 0) <= 10))
  assert.deepEqual(translationPayloads(''), [])
  assert.equal(translationAttachment(attachment('photo.png')).spoiler, false)
})

test('slash send accepts an attachment without text or a target language', async () => {
  const f = await fixture()
  const replies: string[] = []
  await translateCommand.execute({
    inCachedGuild: () => true,
    channel: f.channel,
    guild: { members: { me: {} } },
    user: { id: 'attachment-only-user' },
    client: f.client,
    member: {
      displayName: 'Nickname',
      displayAvatarURL: () => 'https://example.com/avatar.png',
    },
    options: {
      getSubcommand: () => 'send',
      getString: () => null,
      getAttachment: () => attachment(),
    },
    deferReply: async () => {},
    editReply: async (content: string) => replies.push(content),
  } as never)
  assert.equal(f.sent.length, 1)
  assert.equal(f.sent[0].payload.content, undefined)
  assert.equal(f.sent[0].payload.files?.length, 1)
  assert.match(replies[0], /送出附件/)
  const send = translateCommand.data.options?.find(
    (option) => option.name === 'send',
  )
  assert.equal(
    send?.options?.find((option) => option.name === 'message')?.required ??
      false,
    false,
  )
  assert.equal(
    send?.options?.find((option) => option.name === 'attachment')?.type,
    11,
  )
})
