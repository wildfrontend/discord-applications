import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ChannelType, Collection, MessageFlags } from 'discord.js'
import {
  formatJapaneseTime,
  observeTower,
  parseShieldDuration,
  parseTowerRecognition,
  renderTowerSummary,
  resolveTowerTime,
  type TowerArea,
  type TowerRecognition,
  towerAreas,
} from '../src/towers/service.js'

const dataDirectory = mkdtempSync(join(tmpdir(), 'dc-towers-'))
process.env.BOT_DATA_DIR = dataDirectory
process.env.DATABASE_DRIVER = 'sqlite'
process.env.AI_MIN_REQUEST_INTERVAL_MS = '0'
process.env.TOWER_TRACKING_ENABLED = 'true'
delete process.env.DATABASE_URL
const legacy = new DatabaseSync(join(dataDirectory, 'towers.sqlite'))
legacy.exec(`CREATE TABLE tower_observations (
  binding_id TEXT NOT NULL, area INTEGER NOT NULL, server_number INTEGER NOT NULL,
  occupying_tribe TEXT NOT NULL, remaining_seconds INTEGER NOT NULL,
  observed_at INTEGER NOT NULL, available_at INTEGER NOT NULL,
  source_message_id TEXT NOT NULL, source_attachment_id TEXT NOT NULL,
  PRIMARY KEY (binding_id, area)
)`)
legacy
  .prepare('INSERT INTO tower_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(
    'legacy',
    19,
    27,
    '[OLD] Owner',
    3600,
    1793685600000,
    1793689200000,
    'old-message',
    'old-attachment',
  )
legacy.exec(`CREATE TABLE tower_channels (
  channel_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, binding_id TEXT NOT NULL UNIQUE,
  server_number INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
INSERT INTO tower_channels VALUES ('legacy-channel', 'legacy-guild', 'legacy', 27, 'admin', 1793685600000);`)
legacy.close()
const { towerStore } = await import('../src/towers/store.js')
const { handleTowerMessage, startTowerFeature } = await import(
  '../src/towers/feature.js'
)
const { towerImageClient } = await import('../src/towers/ai-client.js')
const { towerDraftStore } = await import('../src/towers/drafts.js')
const { handleTowerDraftInteraction } = await import(
  '../src/towers/draft-flow.js'
)
const { updateTowerSummary } = await import('../src/towers/summary.js')
const { handleTowerUploadInteraction } = await import(
  '../src/towers/upload-flow.js'
)
const { towerUploadModal } = await import('../src/towers/upload-ui.js')
const { default: towerCommand } = await import('../src/commands/tower.js')
const { closeDatabases } = await import('../src/database.js')

after(() => {
  closeDatabases()
  rmSync(dataDirectory, { recursive: true, force: true })
})

const rawReading = {
  isTowerScreenshot: true,
  location: '027-19',
  occupyingTribe: '[PRIZE]\nSTONE',
  shieldRemaining: '31:48:18',
}
const uploadedAt = Date.parse('2026-11-03T17:11:42+09:00')

function recognized(area: TowerArea = 19, serverNumber = 27): TowerRecognition {
  return {
    kind: 'tower',
    reading: {
      serverNumber,
      area,
      occupyingTribe: '[PRIZE] STONE',
      remainingSeconds: 114498,
    },
  }
}

function observation(
  area: TowerArea = 19,
  timestamp = uploadedAt,
  source = '100',
) {
  const result = recognized(area)
  assert.equal(result.kind, 'tower')
  return observeTower(result.reading, timestamp, source, source)
}

test('reads zero-padded map server, occupying tribe and a countdown longer than one day', () => {
  assert.deepEqual(parseTowerRecognition(rawReading), recognized())
  assert.equal(parseShieldDuration('48:00:00'), 172800)
  assert.equal(parseShieldDuration('00:00:00'), 0)
  assert.equal(parseShieldDuration('0:00:01'), 1)
  for (const value of [
    '48:00:01',
    '49:00:00',
    '31:60:00',
    '31:00:60',
    '-1:00:00',
    '31:48',
    null,
    314818,
  ]) {
    assert.equal(parseShieldDuration(value), null)
  }
})

test('migrates old upload-based observations without changing their availability', async () => {
  const [item] = await towerStore.list({
    id: 'legacy',
    guildId: 'guild',
    channelId: 'legacy',
    serverNumber: 27,
  })
  assert.equal(item.observedAt, 1793685600000)
  assert.equal(item.uploadedAt, item.observedAt)
  assert.equal(item.availableAt, 1793689200000)
  assert.equal(item.timeBasis, 'upload')
  assert.equal(item.clock, undefined)
  assert.equal(
    (await towerStore.getBinding('legacy-guild', 'legacy-channel'))
      ?.adoptExistingSummary,
    true,
  )
})

test('extracts optional right-corner clock data without guessing an unreadable UTC label', () => {
  const result = parseTowerRecognition({
    ...rawReading,
    clockTime: '07:11',
    clockIsUtc: true,
  })
  assert.equal(result.kind, 'tower')
  assert.deepEqual(result.reading.clock, { time: '07:11', isUtc: true })
  for (const clock of [
    { clockTime: '24:01', clockIsUtc: true },
    { clockTime: '07:11', clockIsUtc: null },
    { clockTime: null, clockIsUtc: false },
  ]) {
    assert.deepEqual(
      parseTowerRecognition({ ...rawReading, ...clock }),
      recognized(),
    )
  }
})

test('uses a labelled UTC clock to compensate upload delay and handle UTC midnight', () => {
  const upload = Date.parse('2026-11-03T07:16:42Z')
  assert.deepEqual(resolveTowerTime({ time: '07:11', isUtc: true }, upload), {
    observedAt: Date.parse('2026-11-03T07:11:00Z'),
    timeBasis: 'utc-clock',
    timeUncertain: false,
  })
  assert.deepEqual(
    resolveTowerTime(
      { time: '23:58', isUtc: true },
      Date.parse('2026-11-04T00:03:42Z'),
    ),
    {
      observedAt: Date.parse('2026-11-03T23:58:00Z'),
      timeBasis: 'utc-clock',
      timeUncertain: false,
    },
  )
  const result = recognized()
  assert.equal(result.kind, 'tower')
  const item = observeTower(
    { ...result.reading, clock: { time: '07:11', isUtc: true } },
    upload,
    'msg',
    'att',
  )
  assert.equal(item.uploadedAt, upload)
  assert.equal(item.availableAt, Date.parse('2026-11-03T07:11:00Z') + 114498000)
})

test('estimates recent local-clock minute delays across whole, half-hour and quarter-hour offsets', () => {
  const upload = Date.parse('2026-11-03T07:16:42Z')
  for (const time of ['15:11', '12:41', '12:56', '02:11']) {
    assert.deepEqual(resolveTowerTime({ time, isUtc: false }, upload), {
      observedAt: Date.parse('2026-11-03T07:11:00Z'),
      timeBasis: 'minute-estimate',
      timeUncertain: true,
    })
  }
  assert.deepEqual(
    resolveTowerTime(
      { time: '21:58', isUtc: false },
      Date.parse('2026-11-04T00:03:42Z'),
    ),
    {
      observedAt: Date.parse('2026-11-03T23:58:00Z'),
      timeBasis: 'minute-estimate',
      timeUncertain: true,
    },
  )
})

test('falls back to upload time for missing clocks and flags future UTC clocks without dating them yesterday', () => {
  const upload = Date.parse('2026-11-03T07:16:42Z')
  for (const clock of [undefined, { time: 'bad', isUtc: true }]) {
    assert.deepEqual(resolveTowerTime(clock, upload), {
      observedAt: upload,
      timeBasis: 'upload',
      timeUncertain: false,
    })
  }
  assert.deepEqual(resolveTowerTime({ time: '07:20', isUtc: true }, upload), {
    observedAt: upload,
    timeBasis: 'upload',
    timeUncertain: true,
  })
  assert.deepEqual(
    resolveTowerTime(
      { time: '00:03', isUtc: true },
      Date.parse('2026-11-03T23:59:00Z'),
    ),
    {
      observedAt: Date.parse('2026-11-03T23:59:00Z'),
      timeBasis: 'upload',
      timeUncertain: true,
    },
  )
})

test('uses UTC reference time beyond 30 minutes and flags it instead of reverting to upload time', () => {
  const clock = { time: '07:11', isUtc: true }
  assert.equal(
    resolveTowerTime(clock, Date.parse('2026-11-03T07:41:00Z')).timeUncertain,
    false,
  )
  const older = resolveTowerTime(clock, Date.parse('2026-11-03T07:41:01Z'))
  assert.equal(older.observedAt, Date.parse('2026-11-03T07:11:00Z'))
  assert.equal(older.timeBasis, 'utc-clock')
  assert.equal(older.timeUncertain, true)
  const midnight = resolveTowerTime(
    { time: '23:00', isUtc: true },
    Date.parse('2026-11-04T00:02:00Z'),
  )
  assert.equal(midnight.observedAt, Date.parse('2026-11-03T23:00:00Z'))
  assert.equal(midnight.timeUncertain, true)
})

test('rejects incomplete and unrelated images instead of guessing data', () => {
  assert.deepEqual(parseTowerRecognition({ isTowerScreenshot: false }), {
    kind: 'unrelated',
  })
  assert.deepEqual(
    parseTowerRecognition({ ...rawReading, location: '27-10' }),
    { kind: 'unrelated' },
  )
  for (const data of [
    null,
    {},
    { ...rawReading, isTowerScreenshot: 'true' },
    { ...rawReading, location: null },
    { ...rawReading, location: '27' },
    { ...rawReading, location: '0-19' },
    { ...rawReading, shieldRemaining: null },
    { ...rawReading, occupyingTribe: '[-]' },
    { ...rawReading, occupyingTribe: '<@123>' },
    { ...rawReading, occupyingTribe: 'a'.repeat(81) },
  ])
    assert.deepEqual(parseTowerRecognition(data), { kind: 'unreadable' })
})

test('adds only the remaining countdown to upload time and renders all eight towers in Japan time', () => {
  const item = observation()
  assert.equal(item.availableAt, Date.parse('2026-11-05T01:00:00+09:00'))
  assert.equal(formatJapaneseTime(item.availableAt), '11/05 01:00')
  assert.equal(
    formatJapaneseTime(Date.parse('2026-12-31T15:00:00Z')),
    '01/01 00:00',
  )
  const summary = renderTowerSummary(27, [item], 'zt')
  assert.match(summary, /日本時間 \(UTC\+9\)/)
  assert.deepEqual(
    summary
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.split(' ')[1]),
    towerAreas.map((area) => `27-${area}`),
  )
  assert.equal(summary.match(/（留空）/g)?.length, 7)
  assert.ok(summary.includes('27-19 [PRIZE] STONE 11/05 01:00'))
  assert.ok(summary.includes(`<t:${item.availableAt / 1000}:R>`))
  assert.equal(
    renderTowerSummary(28, [item], 'zt').match(/（留空）/g)?.length,
    8,
  )
})

type TestPayload = {
  content: string
  allowedMentions?: object
  components?: Array<{ toJSON(): unknown }>
}
let counter = 0
async function fixture(bound = true, locale: string | null = 'zh-TW') {
  const userId = `user-${++counter}`
  const channelId = `channel-${counter}`
  if (locale) await towerStore.rememberLocale(userId, locale)
  const publicMessages: TestPayload[] = []
  const privateMessages: TestPayload[] = []
  const operations: string[] = []
  const posted = new Collection<string, ReturnType<typeof output>>()
  let response: TowerRecognition = recognized()
  let canPost = true
  let deleted = 0
  let calls = 0
  const attachment = (id = '100') => ({
    id,
    name: 'tower.jpeg',
    size: 1000,
    contentType: 'image/jpeg',
    url: `https://cdn.discordapp.com/attachments/1/2/${id}.jpeg`,
  })
  function output(payload: TestPayload, privateMessage: boolean) {
    const list = privateMessage ? privateMessages : publicMessages
    list.push(payload)
    operations.push(privateMessage ? 'private' : 'published')
    const result = {
      id: `${channelId}-${privateMessage ? 'dm' : 'summary'}-${list.length}`,
      author: { id: 'tower-bot' },
      createdTimestamp: message.createdTimestamp + 100,
      get content() {
        return payload.content
      },
      url: `https://discord.com/channels/guild/${channelId}/${list.length}`,
      edit: async (update: TestPayload) => {
        Object.assign(payload, update)
        operations.push(privateMessage ? 'private-edited' : 'public-edited')
        return result
      },
    }
    return result
  }
  const channel = {
    id: channelId,
    type: ChannelType.GuildText,
    guild: { id: 'guild', members: { fetch: async (id: string) => ({ id }) } },
    permissionsFor: () => ({ has: () => canPost }),
    messages: {
      fetch: async (options: { message?: string; limit?: number }) => {
        if (!options.message) return new Collection([...posted].reverse())
        const value = posted.get(options.message)
        if (!value)
          throw Object.assign(new Error('Unknown message'), { code: 10008 })
        return value
      },
    },
    send: async (payload: TestPayload) => {
      const result = output(payload, false)
      posted.set(result.id, result)
      return result
    },
  }
  const client = {
    user: { id: 'tower-bot' },
    channels: { fetch: async () => channel },
  }
  const message = {
    id: 'source',
    guildId: 'guild',
    channelId,
    client,
    channel,
    inGuild: () => true,
    author: {
      id: userId,
      bot: false,
      send: async (payload: TestPayload) => output(payload, true),
    },
    webhookId: null,
    content: '',
    createdTimestamp: uploadedAt,
    attachments: new Collection([['100', attachment()]]),
    deletable: true,
    fetch: async (_force: boolean) => message,
    delete: async () => {
      deleted++
      operations.push('deleted')
    },
  }
  if (bound) await towerStore.bind('guild', channelId, 27, 'admin')
  const imageClient = {
    recognize: async () => {
      calls++
      return response
    },
  }
  const binding = async () => {
    const value = await towerStore.getBinding('guild', channelId)
    assert.ok(value)
    return value
  }
  const draft = async () => {
    const value = await towerDraftStore.getForUser(await binding(), userId)
    assert.ok(value)
    return value
  }
  async function click(
    customId: string,
    options: { userId?: string; values?: string[] } = {},
  ) {
    let reply: TestPayload | undefined
    const interaction = {
      customId,
      locale: locale ?? 'ja',
      client,
      user: { id: options.userId ?? userId },
      values: options.values ?? [],
      isStringSelectMenu: () => options.values !== undefined,
      reply: async (payload: TestPayload) => {
        reply = payload
      },
      deferUpdate: async () => {},
      editReply: async (payload: TestPayload) => {
        reply = payload
      },
    }
    await handleTowerDraftInteraction(interaction as never)
    assert.ok(reply)
    return reply
  }
  return {
    message,
    client,
    channel,
    attachment,
    imageClient,
    publicMessages,
    privateMessages,
    posted,
    operations,
    binding,
    draft,
    click,
    deleted: () => deleted,
    calls: () => calls,
    canPost: (value: boolean) => {
      canPost = value
    },
    respond: (value: TowerRecognition) => {
      response = value
    },
    handle: () => handleTowerMessage(message as never, imageClient),
  }
}

function publishId(payload: TestPayload): string {
  const row = payload.components?.[1].toJSON() as {
    components: Array<{ custom_id: string }>
  }
  return row.components[0].custom_id
}
function targetId(payload: TestPayload): string {
  const row = payload.components?.[0].toJSON() as {
    components: Array<{ custom_id: string }>
  }
  return row.components[0].custom_id
}

async function submitImages(
  f: Awaited<ReturnType<typeof fixture>>,
  options: {
    userId?: string
    customId?: string
    files?: ReturnType<typeof f.attachment>[]
  } = {},
) {
  const binding = await f.binding()
  let flags: number | undefined
  let response: TestPayload | undefined
  const files = options.files ?? [f.attachment()]
  await handleTowerUploadInteraction(
    {
      id: 'private-upload',
      customId:
        options.customId ??
        `tower-upload-submit:${binding.id}:${f.message.author.id}`,
      user: { id: options.userId ?? f.message.author.id },
      client: f.client,
      locale: 'zh-TW',
      createdTimestamp: f.message.createdTimestamp,
      isButton: () => false,
      fields: {
        getUploadedFiles: () =>
          new Collection(files.map((image) => [image.id, image])),
      },
      deferReply: async (payload: { flags: number }) => {
        flags = payload.flags
      },
      reply: async (payload: TestPayload & { flags?: number }) => {
        response = payload
        flags = payload.flags
      },
      editReply: async (payload: TestPayload) => {
        response = payload
      },
    } as never,
    f.imageClient,
  )
  assert.ok(response)
  return { response, flags }
}

test('upload command opens a private file modal without posting or deferring a public message', async () => {
  const f = await fixture()
  let modal: ReturnType<typeof towerUploadModal> | undefined
  await towerCommand.execute({
    inCachedGuild: () => true,
    guildId: 'guild',
    channelId: f.message.channelId,
    locale: 'zh-TW',
    user: f.message.author,
    client: f.client,
    member: {},
    guild: { channels: { fetch: async () => f.channel }, members: { me: {} } },
    options: { getSubcommand: () => 'upload' },
    showModal: async (value: typeof modal) => {
      modal = value
    },
    deferReply: async () => {
      throw new Error('Must show modal before deferring')
    },
  } as never)
  assert.ok(modal)
  const payload = modal.toJSON()
  assert.equal(
    payload.custom_id,
    `tower-upload-submit:${(await f.binding()).id}:${f.message.author.id}`,
  )
  assert.ok(payload.custom_id.length <= 100)
  assert.equal(payload.components[0].type, 18)
  const label = payload.components[0] as {
    component: { type: number; min_values?: number; max_values?: number }
  }
  assert.equal(label.component.type, 19)
  assert.equal(label.component.min_values, 1)
  assert.equal(label.component.max_values, 10)
  assert.equal(f.publicMessages.length, 0)
  assert.equal(f.privateMessages.length, 0)
  assert.equal(f.calls(), 0)
})

test('private upload modals validate in every supported language', async () => {
  const f = await fixture()
  for (const language of ['zt', 'en', 'ja', 'ko'] as const) {
    const modal = towerUploadModal(
      await f.binding(),
      '12345678901234567890',
      language,
    ).toJSON()
    assert.ok(modal.custom_id.length <= 100)
    assert.ok(modal.title.length <= 45)
  }
})

test('modal images stay private until explicit publication and never post the original file', async () => {
  const f = await fixture()
  const { response, flags } = await submitImages(f)
  assert.equal(flags, MessageFlags.Ephemeral)
  assert.match(response.content, /私人草稿/)
  assert.match(response.content, /27-19 \[PRIZE\] STONE/)
  assert.equal(f.calls(), 1)
  assert.equal(f.deleted(), 0)
  assert.equal(f.publicMessages.length, 0)
  assert.equal(f.privateMessages.length, 0)
  assert.equal((await towerStore.list(await f.binding())).length, 0)
  assert.equal(
    (await f.draft()).observations[0].sourceMessageId,
    'private-upload',
  )
  await f.click(publishId(response))
  assert.equal(f.publicMessages.length, 1)
  assert.match(f.publicMessages[0].content, /27-19 \[PRIZE\] STONE/)
  assert.equal('files' in f.publicMessages[0], false)
})

test('more modal uploads merge privately and stale publish buttons refresh the preview', async () => {
  const f = await fixture()
  const first = await submitImages(f)
  f.respond(recognized(7))
  f.message.createdTimestamp += 60_000
  const second = await submitImages(f)
  assert.equal((await f.draft()).observations.length, 2)
  const stale = await f.click(publishId(first.response))
  assert.match(stale.content, /草稿已更新/)
  assert.equal(f.publicMessages.length, 0)
  await f.click(publishId(second.response))
  assert.equal(f.publicMessages.length, 1)
  assert.match(f.publicMessages[0].content, /27-7 \[PRIZE\] STONE/)
  assert.match(f.publicMessages[0].content, /27-19 \[PRIZE\] STONE/)
})

test('the preview upload button opens another private modal, including from a DM preview', async () => {
  const f = await fixture()
  const { response } = await submitImages(f)
  const row = response.components?.[1].toJSON() as {
    components: Array<{ custom_id: string }>
  }
  let shown = false
  await handleTowerUploadInteraction({
    customId: row.components[2].custom_id,
    locale: 'zh-TW',
    user: f.message.author,
    client: f.client,
    isButton: () => true,
    showModal: async () => {
      shown = true
    },
  } as never)
  assert.equal(shown, true)
  assert.equal(f.publicMessages.length, 0)
})

test('rejects another uploader and permission loss before running recognition', async () => {
  const f = await fixture()
  const other = await submitImages(f, { userId: 'other-user' })
  assert.equal(other.flags, MessageFlags.Ephemeral)
  assert.match(other.response.content, /其他使用者/)
  f.canPost(false)
  const denied = await submitImages(f)
  assert.match(denied.response.content, /沒有.*權限/)
  assert.equal(f.calls(), 0)
  assert.equal(f.publicMessages.length, 0)
})

test('rejects a modal opened before the tower channel was rebound', async () => {
  const f = await fixture()
  const customId = `tower-upload-submit:${(await f.binding()).id}:${f.message.author.id}`
  await towerStore.bind('guild', f.message.channelId, 28, 'admin')
  const result = await submitImages(f, { customId })
  assert.match(result.response.content, /設定已變更/)
  assert.equal(f.calls(), 0)
  assert.equal(f.publicMessages.length, 0)
})

test('modal validation rejects unsupported files privately and keeps existing draft data', async () => {
  const f = await fixture()
  await submitImages(f)
  const invalid = [
    { ...f.attachment('file'), contentType: 'text/plain', name: 'notes.txt' },
    { ...f.attachment('large'), size: 21 * 1024 * 1024 },
    { ...f.attachment('url'), url: 'https://example.com/image.jpg' },
  ]
  const result = await submitImages(f, { files: invalid })
  assert.equal(result.flags, MessageFlags.Ephemeral)
  assert.match(result.response.content, /3 張.*PNG/)
  assert.equal((await f.draft()).observations.length, 1)
  assert.equal(f.calls(), 1)
  assert.equal(f.publicMessages.length, 0)
})

test('empty uploads and uploads over the ten-image limit never call AI or publish', async () => {
  const f = await fixture()
  for (const files of [
    [],
    Array.from({ length: 11 }, (_, i) => f.attachment(`${i}`)),
  ]) {
    const result = await submitImages(f, { files })
    assert.equal(result.flags, MessageFlags.Ephemeral)
    assert.match(result.response.content, /1–10/)
  }
  assert.equal(f.calls(), 0)
  assert.equal(f.publicMessages.length, 0)
  assert.equal(
    await towerDraftStore.getForUser(await f.binding(), f.message.author.id),
    null,
  )
})

test('an empty saved-draft view offers the private upload button without posting publicly', async () => {
  const f = await fixture()
  let response: TestPayload | undefined
  await towerCommand.execute({
    inCachedGuild: () => true,
    guildId: 'guild',
    channelId: f.message.channelId,
    locale: 'zh-TW',
    user: f.message.author,
    client: f.client,
    member: {},
    guild: { channels: { fetch: async () => f.channel }, members: { me: {} } },
    options: { getSubcommand: () => 'draft' },
    deferReply: async () => {},
    editReply: async (payload: TestPayload) => {
      response = payload
    },
  } as never)
  assert.match(response?.content ?? '', /私人上傳視窗/)
  const row = response?.components?.[0].toJSON() as {
    components: Array<{ custom_id: string }>
  }
  assert.equal(
    row.components[0].custom_id,
    `tower-upload:${(await f.binding()).id}`,
  )
  assert.equal(f.publicMessages.length, 0)
})

test('uploads produce private previews, keep public records unchanged, and delete the source', async () => {
  const f = await fixture()
  await f.handle()
  assert.equal(f.publicMessages.length, 0)
  assert.equal(f.privateMessages.length, 1)
  assert.match(f.privateMessages[0].content, /私人草稿/)
  assert.match(f.privateMessages[0].content, /27-19 \[PRIZE\] STONE/)
  assert.equal((await f.draft()).observations.length, 1)
  assert.deepEqual(await towerStore.list(await f.binding()), [])
  assert.equal(await towerStore.getReportingPeriod(await f.binding()), null)
  assert.deepEqual(f.operations, ['private', 'deleted'])
})

test('separate uploads accumulate privately and publishing creates one merged table', async () => {
  const f = await fixture()
  await f.handle()
  f.message.createdTimestamp += 60_000
  f.respond(recognized(7))
  await f.handle()
  assert.equal((await f.draft()).observations.length, 2)
  assert.equal(f.publicMessages.length, 0)
  const done = await f.click(publishId(f.privateMessages[1]))
  assert.match(done.content, /已發布/)
  assert.equal(f.publicMessages.length, 1)
  assert.match(f.publicMessages[0].content, /27-7 \[PRIZE\] STONE/)
  assert.match(f.publicMessages[0].content, /27-19 \[PRIZE\] STONE/)
  assert.equal((await towerStore.list(await f.binding())).length, 2)
  assert.equal(
    await towerDraftStore.getForUser(await f.binding(), f.message.author.id),
    null,
  )
  const period = await towerStore.getReportingPeriod(await f.binding())
  assert.equal(period?.startedAt, uploadedAt)
  assert.equal(period?.endsAt, uploadedAt + 48 * 3600_000)
})

test('new previews do not change a published table until publication, which then edits it in place', async () => {
  const f = await fixture()
  await f.handle()
  await f.click(publishId(f.privateMessages[0]))
  const old = f.publicMessages[0].content
  const id = (await towerStore.getReportingPeriod(await f.binding()))?.messageId
  f.message.createdTimestamp += 60_000
  f.respond(recognized(8))
  await f.handle()
  assert.equal(f.publicMessages[0].content, old)
  assert.equal((await towerStore.list(await f.binding())).length, 1)
  await f.click(publishId(f.privateMessages[1]))
  assert.equal(f.publicMessages.length, 1)
  assert.equal(
    (await towerStore.getReportingPeriod(await f.binding()))?.messageId,
    id,
  )
  assert.match(f.publicMessages[0].content, /27-8 \[PRIZE\] STONE/)
})

test('failed reads remain private, preserve draft rows, and never update public records', async () => {
  const f = await fixture()
  await f.handle()
  f.message.createdTimestamp += 60_000
  f.respond({ kind: 'unreadable' })
  await f.handle()
  assert.match(f.privateMessages[1].content, /無法解析/)
  assert.equal((await f.draft()).observations.length, 1)
  assert.equal(f.publicMessages.length, 0)
  assert.equal(f.deleted(), 2)
  assert.deepEqual(await towerStore.list(await f.binding()), [])
})

test('other servers, invalid formats, and provider errors send private notices and remove images', async () => {
  const f = await fixture()
  f.respond(recognized(19, 28))
  await f.handle()
  assert.match(f.privateMessages[0].content, /其他伺服器/)
  assert.equal((await f.draft()).observations.length, 0)
  f.message.attachments.set('100', {
    ...f.attachment(),
    size: 21 * 1024 * 1024,
  })
  await f.handle()
  assert.match(f.privateMessages[1].content, /無法解析/)
  f.message.attachments.set('100', f.attachment())
  await handleTowerMessage(f.message as never, {
    recognize: async () => {
      throw new Error('provider failed')
    },
  })
  assert.match(f.privateMessages[2].content, /無法解析/)
  assert.equal(f.deleted(), 3)
  assert.equal(f.publicMessages.length, 0)
})

test('blocked DMs expose only a generic recovery notice and retain a resumable private draft', async () => {
  const f = await fixture()
  await handleTowerMessage(
    {
      ...f.message,
      author: {
        ...f.message.author,
        send: async () => {
          throw new Error('DM blocked')
        },
      },
    } as never,
    { recognize: async () => recognized() },
  )
  assert.equal(f.publicMessages.length, 1)
  assert.match(f.publicMessages[0].content, /tower draft/)
  assert.doesNotMatch(f.publicMessages[0].content, /STONE|27-19/)
  assert.equal((await f.draft()).observations.length, 1)
  assert.deepEqual(await towerStore.list(await f.binding()), [])
  assert.equal(f.deleted(), 1)
})

test('stale preview buttons refresh the private draft rather than publishing unreviewed images', async () => {
  const f = await fixture()
  await f.handle()
  const oldButton = publishId(f.privateMessages[0])
  f.message.createdTimestamp += 1000
  f.respond(recognized(7))
  await f.handle()
  const refreshed = await f.click(oldButton)
  assert.match(refreshed.content, /有新圖片/)
  assert.equal(f.publicMessages.length, 0)
  await f.click(publishId(refreshed))
  assert.equal(f.publicMessages.length, 1)
  assert.equal((await towerStore.list(await f.binding())).length, 2)
})

test('another user cannot inspect or publish a draft, and cancellation never changes public records', async () => {
  const f = await fixture()
  await f.handle()
  const draft = await f.draft()
  const denied = await f.click(publishId(f.privateMessages[0]), {
    userId: 'outsider',
  })
  assert.match(denied.content, /其他使用者/)
  assert.equal(f.publicMessages.length, 0)
  await f.click(`tower-cancel:${draft.id}:${draft.revision}`)
  assert.equal(await towerDraftStore.get(draft.id), null)
  assert.deepEqual(await towerStore.list(await f.binding()), [])
})

test('loss of channel permissions prevents publication from an old DM', async () => {
  const f = await fixture()
  await f.handle()
  f.canPost(false)
  const result = await f.click(publishId(f.privateMessages[0]))
  assert.match(result.content, /發送權限/)
  assert.equal(f.publicMessages.length, 0)
  assert.ok(await f.draft())
})

test('target selection is private; a new period at 48 hours preserves the older summary', async () => {
  const f = await fixture()
  await f.handle()
  await f.click(publishId(f.privateMessages[0]))
  const first = await towerStore.getReportingPeriod(await f.binding())
  assert.ok(first)
  const original = f.publicMessages[0].content
  f.message.createdTimestamp = first.endsAt
  f.respond(recognized(7))
  await f.handle()
  const selected = await f.click(targetId(f.privateMessages[1]), {
    values: ['new'],
  })
  assert.equal(f.publicMessages.length, 1)
  assert.equal(f.publicMessages[0].content, original)
  await f.click(publishId(selected))
  assert.equal(f.publicMessages.length, 2)
  assert.equal(f.publicMessages[0].content, original)
  assert.match(f.publicMessages[1].content, /前期回報/)
  assert.equal(
    (await towerStore.getReportingPeriod(await f.binding()))?.startedAt,
    first.endsAt,
  )
})

test('publishing a late screenshot to the previous period edits its snapshot without overwriting the current period', async () => {
  const f = await fixture()
  await f.handle()
  await f.click(publishId(f.privateMessages[0]))
  const first = await towerStore.getReportingPeriod(await f.binding())
  assert.ok(first)
  f.message.createdTimestamp = first.endsAt
  f.respond(recognized(7))
  await f.handle()
  await f.click(publishId(f.privateMessages[1]))
  const second = await towerStore.getReportingPeriod(await f.binding())
  assert.ok(second)
  const currentContent = f.publicMessages[1].content
  // A corrected UTC clock lies just before the current window but is uploaded now.
  f.message.createdTimestamp = first.endsAt + 60_000
  const reading = recognized(12)
  assert.equal(reading.kind, 'tower')
  const time = new Date(first.endsAt - 60_000).toISOString().slice(11, 16)
  f.respond({
    ...reading,
    reading: { ...reading.reading, clock: { time, isUtc: true } },
  })
  await f.handle()
  const selected = await f.click(targetId(f.privateMessages[2]), {
    values: [first.id],
  })
  assert.equal(f.publicMessages[1].content, currentContent)
  await f.click(publishId(selected))
  assert.match(f.publicMessages[0].content, /27-12 \[PRIZE\] STONE/)
  assert.equal(f.publicMessages[1].content, currentContent)
  assert.equal(
    (await towerStore.getReportingPeriod(await f.binding()))?.id,
    second.id,
  )
  assert.ok(
    (await towerStore.listPeriodObservations(await f.binding(), first)).some(
      (item) => item.area === 12,
    ),
  )
  assert.equal(
    (await towerStore.listPeriodObservations(await f.binding(), second)).some(
      (item) => item.area === 12,
    ),
    false,
  )
})

test('forcing a new period closes the old range, while deleted summaries are recreated safely', async () => {
  const f = await fixture()
  await f.handle()
  await f.click(publishId(f.privateMessages[0]))
  const first = await towerStore.getReportingPeriod(await f.binding())
  assert.ok(first?.messageId)
  f.message.createdTimestamp += 3600_000
  f.respond(recognized(7))
  await f.handle()
  const selected = await f.click(targetId(f.privateMessages[1]), {
    values: ['new'],
  })
  await f.click(publishId(selected))
  const periods = await towerStore.listReportingPeriods(await f.binding())
  assert.equal(periods[1].endsAt, periods[0].startedAt)
  assert.ok(periods[0].messageId)
  f.posted.delete(periods[0].messageId)
  f.message.createdTimestamp += 60_000
  f.respond(recognized(8))
  await f.handle()
  await f.click(publishId(f.privateMessages[2]))
  assert.equal(
    (await towerStore.getReportingPeriod(await f.binding()))?.id,
    periods[0].id,
  )
  assert.equal(f.publicMessages.length, 3)
})

test('drafts, published snapshots, and canonical message IDs survive a new process', async () => {
  const f = await fixture()
  await f.handle()
  await f.click(publishId(f.privateMessages[0]))
  f.message.createdTimestamp += 1000
  f.respond(recognized(7))
  await f.handle()
  const binding = await f.binding()
  const script = `const { towerStore } = await import('./src/towers/store.ts'); const { towerDraftStore } = await import('./src/towers/drafts.ts');
    const binding = await towerStore.getBinding('guild', ${JSON.stringify(f.message.channelId)});
    console.log(JSON.stringify({ period: await towerStore.getReportingPeriod(binding), draft: await towerDraftStore.getForUser(binding, ${JSON.stringify(f.message.author.id)}) }));
    const { closeDatabases } = await import('./src/database.ts'); closeDatabases();`
  const result = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: process.env,
      encoding: 'utf8',
    },
  )
  assert.deepEqual(JSON.parse(result), {
    period: await towerStore.getReportingPeriod(binding),
    draft: await f.draft(),
  })
})

test('each uploader uses their own remembered Discord locale, with Japanese as fallback', async () => {
  for (const [locale, label] of [
    [null, '非公開'],
    ['en-US', 'Private draft'],
    ['zh-TW', '私人草稿'],
    ['ko', '비공개'],
  ] as const) {
    const f = await fixture(true, locale)
    await f.handle()
    assert.ok(f.privateMessages[0].content.startsWith(label))
    assert.equal(f.publicMessages.length, 0)
  }
})

test('unconfigured channels, bot messages, and non-image files do not call AI or send DMs', async () => {
  const f = await fixture(false)
  await f.handle()
  await towerStore.bind('guild', f.message.channelId, 27, 'admin')
  f.message.author.bot = true
  await f.handle()
  f.message.author.bot = false
  f.message.attachments.set('100', {
    ...f.attachment(),
    contentType: 'text/plain',
    name: 'notes.txt',
  })
  await f.handle()
  assert.equal(f.calls(), 0)
  assert.equal(f.privateMessages.length, 0)
})

test('cleanup failures are reported privately, and non-image attachments are retained', async () => {
  const f = await fixture()
  f.message.deletable = false
  await f.handle()
  assert.match(f.privateMessages[0].content, /管理訊息/)
  assert.equal(f.publicMessages.length, 0)
  assert.equal(f.deleted(), 0)
  f.message.deletable = true
  f.message.attachments.set('file', {
    ...f.attachment('file'),
    name: 'notes.txt',
    contentType: 'text/plain',
  })
  await f.handle()
  assert.equal(f.deleted(), 0)
  assert.match(f.privateMessages[1].content, /圖片以外/)
})

test('double publication and outdated channel bindings cannot create duplicate public tables', async () => {
  const f = await fixture()
  await f.handle()
  const button = publishId(f.privateMessages[0])
  await f.click(button)
  await f.click(button)
  assert.equal(f.publicMessages.length, 1)
  f.message.createdTimestamp += 1000
  f.respond(recognized(7))
  await f.handle()
  await towerStore.bind('guild', f.message.channelId, 28, 'admin')
  const result = await f.click(publishId(f.privateMessages[1]))
  assert.match(result.content, /設定已變更/)
  assert.equal(f.publicMessages.length, 1)
})

test('published latest records reject older captures and preserve uncertainty markers', async () => {
  const f = await fixture()
  const binding = await f.binding()
  const result = recognized()
  assert.equal(result.kind, 'tower')
  const old = observeTower(
    { ...result.reading, clock: { time: '07:11', isUtc: true } },
    Date.parse('2026-11-03T08:00:00Z'),
    'old',
    '100',
  )
  const fresh = observeTower(
    { ...result.reading, clock: { time: '07:20', isUtc: true } },
    Date.parse('2026-11-03T08:01:00Z'),
    'fresh',
    '101',
  )
  assert.equal(await towerStore.save(binding, fresh), true)
  assert.equal(await towerStore.save(binding, old), false)
  assert.deepEqual(await towerStore.list(binding), [fresh])
  assert.match(renderTowerSummary(27, [fresh], 'zt'), /可能有誤差/)
})
test('a private slash command resumes a draft without requiring Manage Channels or publishing data', async () => {
  const f = await fixture()
  await f.handle()
  let flags: number | undefined
  let response: TestPayload | undefined
  await towerCommand.execute({
    inCachedGuild: () => true,
    guildId: 'guild',
    channelId: f.message.channelId,
    locale: 'zh-TW',
    user: f.message.author,
    client: f.client,
    member: {},
    guild: { channels: { fetch: async () => f.channel }, members: { me: {} } },
    options: { getSubcommand: () => 'draft' },
    deferReply: async (payload: { flags: number }) => {
      flags = payload.flags
    },
    editReply: async (payload: TestPayload) => {
      response = payload
    },
  } as never)
  assert.equal(flags, MessageFlags.Ephemeral)
  assert.match(response?.content ?? '', /私人草稿/)
  assert.equal(f.publicMessages.length, 0)
})

test('failed publication preserves the draft for retry without posting duplicate summaries', async () => {
  const f = await fixture()
  await f.handle()
  const send = f.channel.send
  f.channel.send = async () => {
    throw new Error('Discord unavailable')
  }
  const failed = await f.click(publishId(f.privateMessages[0]))
  assert.match(failed.content, /無法發布/)
  assert.ok(await f.draft())
  assert.equal(f.publicMessages.length, 0)
  f.channel.send = send
  await f.click(publishId(failed))
  assert.equal(f.publicMessages.length, 1)
  assert.equal(
    await towerDraftStore.getForUser(await f.binding(), f.message.author.id),
    null,
  )
})

test('locale interaction caching remains active alongside private draft handlers', async () => {
  const handlers = new Map<string, Array<(value: unknown) => unknown>>()
  startTowerFeature({
    on: (event: string, handler: (value: unknown) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
  } as never)
  const interaction = {
    user: { id: 'locale-test' },
    locale: 'en-US',
    createdTimestamp: 100,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
  }
  await Promise.all(
    (handlers.get('interactionCreate') ?? []).map((handler) =>
      handler(interaction),
    ),
  )
  assert.equal(await towerStore.getLocale('locale-test'), 'en-US')
})

test('legacy adoption uses an existing bot summary and persists its independent historical snapshot', async () => {
  const f = await fixture()
  const binding = await f.binding()
  const item = observation()
  await towerStore.save(binding, item)
  const existing = await f.channel.send({
    content: renderTowerSummary(27, [item], 'zt'),
  })
  f.message.createdTimestamp += 60_000
  await updateTowerSummary(
    f.message as never,
    { ...binding, adoptExistingSummary: true },
    'zt',
    [],
  )
  const period = await towerStore.getReportingPeriod(binding)
  assert.ok(period)
  assert.equal(period.messageId, existing.id)
  assert.equal(f.publicMessages.length, 1)
  assert.deepEqual(await towerStore.listPeriodObservations(binding, period), [
    item,
  ])
})

test('vision client sends image content, uses the optional model, and validates JSON responses', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.AI_API_KEY
  const originalModel = process.env.TOWER_AI_MODEL
  process.env.AI_API_KEY = 'test-key'
  process.env.TOWER_AI_MODEL = 'test-vision-model'
  let output: unknown = rawReading
  let status = 200
  let finishReason = 'stop'
  globalThis.fetch = async (_input, options) => {
    const body = JSON.parse(String(options?.body))
    assert.equal(body.model, 'test-vision-model')
    assert.equal(body.response_format.type, 'json_object')
    assert.match(body.messages[0].content, /untrusted data/)
    assert.match(body.messages[0].content, /部落嘗試佔領/)
    assert.equal(
      body.messages[1].content[1].image_url.url,
      'https://cdn.discordapp.com/tower.jpeg',
    )
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: finishReason,
            message: {
              content:
                typeof output === 'string' ? output : JSON.stringify(output),
            },
          },
        ],
      }),
      { status },
    )
  }
  try {
    assert.deepEqual(
      await towerImageClient.recognize('https://cdn.discordapp.com/tower.jpeg'),
      recognized(),
    )
    output = { ...rawReading, shieldRemaining: null }
    assert.deepEqual(
      await towerImageClient.recognize('https://cdn.discordapp.com/tower.jpeg'),
      { kind: 'unreadable' },
    )
    output = 'not json'
    await assert.rejects(
      towerImageClient.recognize('https://cdn.discordapp.com/tower.jpeg'),
      /格式無效/,
    )
    status = 429
    await assert.rejects(
      towerImageClient.recognize('https://cdn.discordapp.com/tower.jpeg'),
      /HTTP 429/,
    )
    status = 200
    finishReason = 'length'
    await assert.rejects(
      towerImageClient.recognize('https://cdn.discordapp.com/tower.jpeg'),
      /未完成/,
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.AI_API_KEY
    else process.env.AI_API_KEY = originalKey
    if (originalModel === undefined) delete process.env.TOWER_AI_MODEL
    else process.env.TOWER_AI_MODEL = originalModel
  }
})
