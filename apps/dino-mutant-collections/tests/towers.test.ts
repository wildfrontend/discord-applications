import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ChannelType,
  Collection,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js'
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
legacy.close()
const { towerStore } = await import('../src/towers/store.js')
const { handleTowerMessage, startTowerFeature } = await import(
  '../src/towers/feature.js'
)
const { towerImageClient } = await import('../src/towers/ai-client.js')
const { towerLanguage } = await import('../src/towers/i18n.js')
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
  })
  assert.deepEqual(
    resolveTowerTime(
      { time: '23:58', isUtc: true },
      Date.parse('2026-11-04T00:03:42Z'),
    ),
    {
      observedAt: Date.parse('2026-11-03T23:58:00Z'),
      timeBasis: 'utc-clock',
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
    },
  )
})

test('falls back to upload time for missing clocks, stale/future UTC readings, or excessive minute lag', () => {
  const upload = Date.parse('2026-11-03T07:16:42Z')
  for (const clock of [
    undefined,
    { time: 'bad', isUtc: true },
    { time: '06:40', isUtc: true },
    { time: '07:20', isUtc: true },
    { time: '15:05', isUtc: false },
  ]) {
    assert.deepEqual(resolveTowerTime(clock, upload), {
      observedAt: upload,
      timeBasis: 'upload',
    })
  }
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

let counter = 0
async function fixture(bound = true, locale: string | null = 'zh-TW') {
  const channelId = `channel-${++counter}`
  const userId = `user-${counter}`
  if (locale) await towerStore.rememberLocale(userId, locale)
  const replies: Array<{ content: string; allowedMentions: object }> = []
  const operations: string[] = []
  let deleted = 0
  let calls = 0
  let response: TowerRecognition = recognized()
  const attachment = (id = '100') => ({
    id,
    name: 'tower.jpeg',
    contentType: 'image/jpeg',
    size: 1024,
    url: `https://cdn.discordapp.com/attachments/1/2/${id}.jpeg`,
  })
  const message = {
    id: 'message',
    guildId: 'guild',
    channelId,
    inGuild: () => true,
    author: { id: userId, bot: false },
    content: '',
    webhookId: null,
    createdTimestamp: uploadedAt,
    attachments: new Collection([['100', attachment()]]),
    channel: {
      send: async (payload: { content: string; allowedMentions: object }) => {
        operations.push('sent')
        replies.push(payload)
        return {
          edit: async (update: { content: string }) => {
            Object.assign(payload, update)
          },
        }
      },
    },
    reply: async () => {
      throw new Error('Do not reply to source images')
    },
    deletable: true,
    fetch: async (_force: boolean) => message,
    delete: async () => {
      operations.push('deleted')
      deleted++
    },
  }
  if (bound) await towerStore.bind('guild', channelId, 27, 'admin')
  const client = {
    recognize: async () => {
      calls++
      return response
    },
  }
  return {
    message,
    client,
    attachment,
    replies,
    operations,
    deleted: () => deleted,
    calls: () => calls,
    respond: (result: TowerRecognition) => {
      response = result
    },
    handle: () => handleTowerMessage(message as never, client),
    binding: async () => {
      const binding = await towerStore.getBinding('guild', channelId)
      assert.ok(binding)
      return binding
    },
  }
}

test('unconfigured channels, bots, webhooks, and non-image attachments never call AI', async () => {
  const f = await fixture(false)
  await f.handle()
  await towerStore.bind('guild', f.message.channelId, 27, 'admin')
  f.message.author.bot = true
  await f.handle()
  f.message.author.bot = false
  await handleTowerMessage(
    { ...f.message, webhookId: 'webhook' } as never,
    f.client,
  )
  f.message.attachments.set('100', {
    ...f.attachment(),
    contentType: 'text/plain',
    name: 'notes.txt',
  })
  await f.handle()
  assert.equal(f.calls(), 0)
  assert.equal(f.replies.length, 0)
})

test('one message with multiple images updates separate towers and replies with one summary', async () => {
  const f = await fixture()
  f.message.attachments.set('101', f.attachment('101'))
  const responses = [recognized(7), recognized(19)]
  await handleTowerMessage(f.message as never, {
    recognize: async () => responses.shift() ?? { kind: 'unrelated' },
  })
  const items = await towerStore.list(await f.binding())
  assert.deepEqual(
    items.map((item) => item.area),
    [7, 19],
  )
  assert.ok(
    items.every(
      (item) => item.availableAt === Date.parse('2026-11-05T01:00:00+09:00'),
    ),
  )
  assert.equal(f.replies.length, 1)
  assert.deepEqual(f.replies[0].allowedMentions, {
    parse: [],
    repliedUser: false,
  })
  assert.equal(f.replies[0].content.match(/（留空）/g)?.length, 6)
})

test('other servers, unreadable fields, unrelated images and provider errors do not overwrite existing records', async () => {
  const f = await fixture()
  await f.handle()
  const original = await towerStore.list(await f.binding())
  f.respond(recognized(19, 28))
  await f.handle()
  assert.match(f.replies.at(-1)?.content ?? '', /只記錄 27 服/)
  f.respond({ kind: 'unreadable' })
  await f.handle()
  assert.match(f.replies.at(-1)?.content ?? '', /無法解析/)
  f.respond({ kind: 'unrelated' })
  const count = f.replies.length
  await f.handle()
  assert.equal(f.replies.length, count + 1)
  assert.match(f.replies.at(-1)?.content ?? '', /無法解析/)
  await handleTowerMessage(f.message as never, {
    recognize: async () => {
      throw new Error('provider failure')
    },
  })
  assert.match(f.replies.at(-1)?.content ?? '', /無法解析/)
  assert.deepEqual(await towerStore.list(await f.binding()), original)
})

test('rejects oversized or unsupported images and URLs outside Discord before calling AI', async () => {
  const f = await fixture()
  for (const overrides of [
    { size: 21 * 1024 * 1024 },
    { name: 'tower.gif', contentType: 'image/gif' },
    { url: 'https://example.com/image.jpeg' },
    { url: 'http://cdn.discordapp.com/image.jpeg' },
  ]) {
    f.message.attachments.set('100', { ...f.attachment(), ...overrides })
    await f.handle()
  }
  assert.equal(f.calls(), 0)
  assert.equal((await towerStore.list(await f.binding())).length, 0)
})

test('compares calibrated capture minutes so an older photo uploaded later cannot replace newer records', async () => {
  const f = await fixture()
  const binding = await f.binding()
  const result = recognized()
  assert.equal(result.kind, 'tower')
  const latest = observeTower(
    { ...result.reading, clock: { time: '07:15', isUtc: true } },
    Date.parse('2026-11-03T07:16:42Z'),
    'new',
    '100',
  )
  assert.equal(await towerStore.save(binding, latest), true)
  assert.deepEqual(await towerStore.list(binding), [latest])
  const lateOldImage = observeTower(
    {
      ...result.reading,
      occupyingTribe: '[OLD] Owner',
      clock: { time: '07:11', isUtc: true },
    },
    Date.parse('2026-11-03T07:20:42Z'),
    'late',
    '101',
  )
  assert.equal(await towerStore.save(binding, lateOldImage), false)
  assert.deepEqual(await towerStore.list(binding), [latest])
  // Seconds are absent in the image clock; newer uploads break same-minute ties.
  const sameMinute = observeTower(
    {
      ...result.reading,
      remainingSeconds: 114490,
      clock: { time: '07:15', isUtc: true },
    },
    Date.parse('2026-11-03T07:17:00Z'),
    'same-minute',
    '102',
  )
  assert.equal(await towerStore.save(binding, sameMinute), true)
  assert.deepEqual(await towerStore.list(binding), [sameMinute])
})

test('processing preserves clock metadata and exposes the estimate basis in localized summaries', async () => {
  const f = await fixture()
  const result = recognized()
  assert.equal(result.kind, 'tower')
  f.message.createdTimestamp = Date.parse('2026-11-03T07:16:42Z')
  f.respond({
    ...result,
    reading: { ...result.reading, clock: { time: '12:56', isUtc: false } },
  })
  await f.handle()
  const [item] = await towerStore.list(await f.binding())
  assert.equal(item.timeBasis, 'minute-estimate')
  assert.equal(item.observedAt, Date.parse('2026-11-03T07:11:00Z'))
  assert.deepEqual(item.clock, { time: '12:56', isUtc: false })
  assert.match(f.replies[0].content, /分鐘推估/)
  assert.match(f.replies[0].content, /10 分鐘/)
  assert.equal(f.deleted(), 1)
})

test('newer uploads replace the owner; duplicates and older completed work cannot overwrite them', async () => {
  const f = await fixture()
  const binding = await f.binding()
  assert.equal(await towerStore.save(binding, observation()), true)
  assert.equal(await towerStore.save(binding, observation()), false)
  const newer = {
    ...observation(19, uploadedAt + 1000, '101'),
    occupyingTribe: '[NEXT] Owner',
  }
  assert.equal(await towerStore.save(binding, newer), true)
  assert.equal(await towerStore.save(binding, observation()), false)
  assert.deepEqual(await towerStore.list(binding), [newer])
  assert.equal(
    await towerStore.save(binding, { ...newer, serverNumber: 28 }),
    false,
  )
  const other = await fixture()
  assert.deepEqual(await towerStore.list(await other.binding()), [])
})

test('uploads refresh the same 48-hour cycle and a later occupation starts a new cycle', async () => {
  const f = await fixture()
  const binding = await f.binding()
  const otherTower = observation(7)
  await towerStore.save(binding, otherTower)

  async function upload(
    time: string,
    remainingSeconds: number,
    tribe = '[PRIZE] STONE',
  ) {
    f.message.createdTimestamp = Date.parse(time)
    const result = recognized()
    assert.equal(result.kind, 'tower')
    f.respond({
      ...result,
      reading: { ...result.reading, remainingSeconds, occupyingTribe: tribe },
    })
    await f.handle()
    const item = (await towerStore.list(binding)).find(
      (tower) => tower.area === 19,
    )
    assert.ok(item)
    return item
  }

  const first = await upload('2026-11-03T09:00:00+09:00', 48 * 3600)
  assert.equal(formatJapaneseTime(first.availableAt), '11/05 09:00')
  const refreshed = await upload('2026-11-04T09:00:00+09:00', 24 * 3600)
  assert.equal(refreshed.availableAt, first.availableAt)
  assert.ok(refreshed.observedAt > first.observedAt)

  // A newer screenshot may correct the estimate earlier as well as later.
  const corrected = await upload(
    '2026-11-04T15:00:00+09:00',
    17 * 3600 + 50 * 60,
  )
  assert.equal(formatJapaneseTime(corrected.availableAt), '11/05 08:50')
  f.message.createdTimestamp = Date.parse('2026-11-04T16:00:00+09:00')
  f.respond({ kind: 'unreadable' })
  await f.handle()
  assert.deepEqual(
    (await towerStore.list(binding)).find((tower) => tower.area === 19),
    corrected,
  )

  const nextCycle = await upload(
    '2026-11-05T10:00:00+09:00',
    48 * 3600,
    '[NEXT] Owner',
  )
  assert.equal(formatJapaneseTime(nextCycle.availableAt), '11/07 10:00')
  assert.equal(nextCycle.occupyingTribe, '[NEXT] Owner')
  const lateResult = await upload('2026-11-04T17:00:00+09:00', 16 * 3600)
  assert.deepEqual(lateResult, nextCycle)
  assert.deepEqual(
    (await towerStore.list(binding)).find((tower) => tower.area === 7),
    otherTower,
  )
})

test('same-server setup preserves data; rebinding and disabling reject pending AI work', async () => {
  const f = await fixture()
  const binding = await f.binding()
  await f.handle()
  await towerStore.bind('guild', f.message.channelId, 27, 'admin')
  assert.equal((await f.binding()).id, binding.id)
  assert.equal((await towerStore.list(binding)).length, 1)
  await handleTowerMessage(
    {
      ...f.message,
      id: 'pending',
      createdTimestamp: uploadedAt + 5000,
    } as never,
    {
      recognize: async () => {
        await towerStore.bind('guild', f.message.channelId, 28, 'admin')
        return recognized()
      },
    },
  )
  assert.equal(f.replies.length, 1)
  const rebound = await f.binding()
  assert.notEqual(rebound.id, binding.id)
  assert.deepEqual(await towerStore.list(rebound), [])
  assert.equal(await towerStore.save(binding, observation(7)), false)
  await towerStore.disable('guild', f.message.channelId)
  assert.equal(await towerStore.getBinding('guild', f.message.channelId), null)
  assert.equal(
    await towerStore.save(rebound, { ...observation(), serverNumber: 28 }),
    false,
  )
})

test('bindings and observations survive a separate process reading the same SQLite data', async () => {
  const f = await fixture()
  await f.handle()
  const script = `const { towerStore } = await import('./src/towers/store.ts');
    const binding = await towerStore.getBinding('guild', ${JSON.stringify(f.message.channelId)});
    console.log(JSON.stringify(await towerStore.list(binding)));
    const { closeDatabases } = await import('./src/database.ts'); closeDatabases();`
  const output = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      env: process.env,
    },
  )
  assert.deepEqual(JSON.parse(output), await towerStore.list(await f.binding()))
})

test('setup requires Manage Channels while regular members can list the configured towers', async () => {
  const f = await fixture()
  const replies: Array<{ content: string; flags?: number }> = []
  let action = 'setup'
  let canManage = false
  const channel = {
    id: f.message.channelId,
    type: ChannelType.GuildText,
    permissionsFor: () => ({
      has: (permission: unknown) =>
        permission === PermissionFlagsBits.ManageChannels ? canManage : true,
    }),
  }
  const interaction = {
    inCachedGuild: () => true,
    guildId: 'guild',
    channelId: channel.id,
    guild: { channels: { fetch: async () => channel }, members: { me: {} } },
    member: {},
    user: { id: 'admin' },
    locale: 'zh-TW',
    options: {
      getSubcommand: () => action,
      getChannel: () => null,
      getInteger: () => 28,
    },
    reply: async (payload: { content: string; flags?: number }) => {
      replies.push(payload)
    },
    deferReply: async () => {},
    editReply: async (
      payload: { content: string; flags?: number } | string,
    ) => {
      replies.push(typeof payload === 'string' ? { content: payload } : payload)
    },
  }
  await towerCommand.execute(interaction as never)
  assert.match(replies.at(-1)?.content ?? '', /管理頻道/)
  assert.equal(replies.at(-1)?.flags, MessageFlags.Ephemeral)
  assert.equal((await f.binding()).serverNumber, 27)
  action = 'list'
  await towerCommand.execute(interaction as never)
  assert.match(replies.at(-1)?.content ?? '', /27-17 （留空）/)
  action = 'setup'
  canManage = true
  await towerCommand.execute(interaction as never)
  assert.equal((await f.binding()).serverNumber, 28)
  action = 'disable'
  await towerCommand.execute(interaction as never)
  assert.equal(await towerStore.getBinding('guild', channel.id), null)
})

test('the event listener catches rejected work and continues handling later messages', {
  timeout: 5000,
}, async () => {
  const f = await fixture()
  let listener: ((message: unknown) => void) | undefined
  startTowerFeature({
    on: (_event: string, handler: typeof listener) => {
      listener = handler
    },
  } as never)
  assert.ok(listener)
  const originalRecognize = towerImageClient.recognize
  let calls = 0
  towerImageClient.recognize = async () => recognized(calls++ === 0 ? 19 : 7)
  const completed = Promise.withResolvers<void>()
  try {
    listener({
      ...f.message,
      channel: {
        send: async () => {
          throw new Error('reply unavailable')
        },
      },
    })
    listener({
      ...f.message,
      id: 'second',
      createdTimestamp: uploadedAt + 1000,
      channel: {
        send: async () => {
          completed.resolve()
          return { edit: async () => {} }
        },
      },
    })
    await completed.promise
    assert.equal(calls, 2)
    assert.deepEqual(
      (await towerStore.list(await f.binding())).map((item) => item.area),
      [7, 19],
    )
  } finally {
    towerImageClient.recognize = originalRecognize
  }
})

test('successful image posts are removed only after the text result is sent, including captions', async () => {
  const f = await fixture()
  f.message.content = '27-19 update'
  await f.handle()
  assert.deepEqual(f.operations, ['sent', 'deleted'])
  assert.equal(f.deleted(), 1)
  assert.equal((await towerStore.list(await f.binding())).length, 1)
})

test('failed, unrelated, unsupported, and wrong-server image posts are also removed', async () => {
  for (const result of [
    { kind: 'unreadable' },
    { kind: 'unrelated' },
    recognized(19, 28),
  ] as TowerRecognition[]) {
    const f = await fixture()
    f.respond(result)
    await f.handle()
    assert.equal(f.deleted(), 1)
    assert.equal((await towerStore.list(await f.binding())).length, 0)
    assert.match(
      f.replies[0].content,
      result.kind === 'tower' ? /其他伺服器/ : /無法解析/,
    )
  }
  const unsupported = await fixture()
  unsupported.message.attachments.set('100', {
    ...unsupported.attachment(),
    size: 21 * 1024 * 1024,
  })
  await unsupported.handle()
  assert.equal(unsupported.deleted(), 1)
  assert.equal(unsupported.calls(), 0)
  const failed = await fixture()
  await handleTowerMessage(failed.message as never, {
    recognize: async () => {
      throw new Error('AI unavailable')
    },
  })
  assert.equal(failed.deleted(), 1)
  assert.match(failed.replies[0].content, /無法解析/)
})

test('posting failures retain source images, while deletion failures preserve the completed result', async () => {
  const f = await fixture()
  await assert.rejects(
    handleTowerMessage(
      {
        ...f.message,
        channel: {
          send: async () => {
            throw new Error('send failed')
          },
        },
      } as never,
      f.client,
    ),
    /send failed/,
  )
  assert.equal(f.deleted(), 0)
  f.message.deletable = false
  await f.handle()
  assert.equal(f.deleted(), 0)
  assert.match(f.replies.at(-1)?.content ?? '', /管理訊息/)
  f.message.deletable = true
  const denied = {
    ...f.message,
    delete: async () => {
      throw new Error('delete failed')
    },
  }
  await handleTowerMessage(
    { ...denied, fetch: async () => denied } as never,
    f.client,
  )
  assert.equal(f.deleted(), 0)
  assert.match(f.replies.at(-1)?.content ?? '', /無法刪除原圖/)
  assert.equal((await towerStore.list(await f.binding())).length, 1)
})

test('does not discard non-image files or attachments added during analysis', async () => {
  const f = await fixture()
  f.message.attachments.set('file', {
    ...f.attachment('file'),
    name: 'notes.txt',
    contentType: 'text/plain',
  })
  await f.handle()
  assert.equal(f.deleted(), 0)
  assert.match(f.replies[0].content, /圖片以外/)
  f.message.attachments.delete('file')
  await handleTowerMessage(
    {
      ...f.message,
      fetch: async () => ({
        ...f.message,
        attachments: new Collection([['new', f.attachment('new')]]),
      }),
    } as never,
    f.client,
  )
  assert.equal(f.deleted(), 0)
  assert.match(f.replies.at(-1)?.content ?? '', /附件已變更/)
})

test('uses each uploader’s cached Discord locale and Japanese for first-time users', async () => {
  for (const [locale, expected] of [
    [null, 'バフタワー'],
    ['ja', 'バフタワー'],
    ['zh-TW', '增益塔'],
    ['en-US', 'Buff towers'],
    ['ko', '버프 타워'],
  ] as const) {
    const f = await fixture(true, locale)
    await f.handle()
    assert.ok(f.replies[0].content.startsWith(expected))
    assert.ok(f.replies[0].content.includes('UTC+9'))
    assert.equal(f.deleted(), 1)
  }
  const failed = await fixture(true, 'en-GB')
  failed.respond({ kind: 'unreadable' })
  await failed.handle()
  assert.match(failed.replies[0].content, /Could not parse/)
  assert.equal(towerLanguage('zh-CN'), 'zt')
  assert.equal(towerLanguage('fr'), 'ja')
})

test('remembers Discord locale from interactions and ignores older locale events', async () => {
  const handlers = new Map<string, (event: unknown) => Promise<void>>()
  startTowerFeature({
    on: (name: string, handler: (event: unknown) => Promise<void>) =>
      handlers.set(name, handler),
  } as never)
  const onInteraction = handlers.get('interactionCreate')
  assert.ok(onInteraction)
  await onInteraction({
    user: { id: 'locale-user' },
    locale: 'ja',
    createdTimestamp: 100,
  })
  await onInteraction({
    user: { id: 'locale-user' },
    locale: 'en-US',
    createdTimestamp: 200,
  })
  await onInteraction({
    user: { id: 'locale-user' },
    locale: 'ko',
    createdTimestamp: 150,
  })
  assert.equal(await towerStore.getLocale('locale-user'), 'en-US')
  assert.equal(await towerStore.getLocale('unknown-user'), null)
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
