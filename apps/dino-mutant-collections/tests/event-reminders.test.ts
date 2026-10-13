import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  type Client,
  Collection,
  GuildScheduledEventStatus,
  PermissionFlagsBits,
} from 'discord.js'

const dataDirectory = mkdtempSync(join(tmpdir(), 'dc-event-reminders-'))
process.env.BOT_DATA_DIR = dataDirectory
process.env.DATABASE_DRIVER = 'sqlite'
delete process.env.DATABASE_URL
const legacy = new DatabaseSync(join(dataDirectory, 'recurring-events.sqlite'))
legacy.exec(`
  CREATE TABLE recurring_events (
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, source_event_id TEXT NOT NULL,
    latest_event_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    interval_value INTEGER NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('minutes','hours','days','weeks')),
    next_start_at TEXT NOT NULL, template_json TEXT NOT NULL,
    UNIQUE (guild_id, source_event_id)
  );
  CREATE TABLE event_notification_settings (
    guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL,
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  INSERT INTO event_notification_settings VALUES ('legacy-guild', 'legacy-channel', 'admin', '2026-10-13');
  CREATE TABLE event_schedule_notifications (
    schedule_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    role_id TEXT, remind_before_minutes INTEGER NOT NULL DEFAULT 30, enabled INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  INSERT INTO event_schedule_notifications VALUES ('legacy-schedule', 'legacy-guild', 'individual-channel', 'legacy-role', 60, 1, 'admin', '2026-10-13');
`)
legacy.close()

const { eventNotificationStore, eventReminderStore, recurringEventStore } =
  await import('../src/recurring-events/store.js')
const { buildSchedule, createRecurringSchedule } = await import(
  '../src/recurring-events/service.js'
)
const { sendDueEventReminders } = await import(
  '../src/recurring-events/reminders.js'
)
const { startRecurringEventScheduler } = await import(
  '../src/recurring-events/scheduler.js'
)
const { closeDatabases } = await import('../src/database.js')
const { dataDirectory: actualDataDirectory } = await import(
  '../src/recurring-events/storage.js'
)
assert.equal(actualDataDirectory, dataDirectory)
const { default: eventCommand } = await import('../src/commands/event.js')
const realNow = Date.now
let now = Date.parse('2026-10-13T04:00:00Z')
const minute = 60_000
let counter = 0

beforeEach(async () => {
  for (const schedule of await recurringEventStore.list()) {
    await recurringEventStore.remove(schedule.guildId, schedule.id)
  }
  now = Date.parse('2026-10-13T04:00:00Z')
  Date.now = () => now
})
after(() => {
  Date.now = realNow
  closeDatabases()
  rmSync(dataDirectory, { recursive: true, force: true })
})

function fixture(startInMinutes = 60) {
  const guildId = `guild-${++counter}`
  const event = {
    id: `event-${counter}`,
    guildId,
    name: 'Raid @everyone <@&other-role>',
    description: null,
    entityType: 3,
    privacyLevel: 2,
    channelId: null,
    entityMetadata: { location: 'Online' },
    scheduledStartTimestamp: now + startInMinutes * minute,
    scheduledEndTimestamp: now + (startInMinutes + 60) * minute,
    status: GuildScheduledEventStatus.Scheduled,
    url: `https://discord.com/events/${guildId}/event-${counter}`,
  }
  const events = new Collection<string, typeof event>([[event.id, event]])
  const sent: Array<{
    channelId: string
    payload: {
      content: string
      allowedMentions: { parse: string[]; roles: string[] }
    }
  }> = []
  let failSend = false
  const guild = {
    id: guildId,
    scheduledEvents: {
      cache: events,
      async fetch(id?: string) {
        return id ? (events.get(id) ?? null) : events
      },
      async create(options: {
        scheduledStartTime: Date
        scheduledEndTime: Date
      }) {
        const created = {
          ...event,
          id: `event-${counter}-next`,
          scheduledStartTimestamp: options.scheduledStartTime.getTime(),
          scheduledEndTimestamp: options.scheduledEndTime.getTime(),
        }
        events.set(created.id, created)
        return created
      },
    },
  }
  const client = {
    guilds: {
      cache: new Collection([[guildId, guild]]),
      async fetch() {
        return guild
      },
    },
    channels: {
      async fetch(channelId: string) {
        return {
          guildId,
          isSendable: () => true,
          async send(payload: (typeof sent)[number]['payload']) {
            if (failSend) throw new Error('temporary send failure')
            sent.push({ channelId, payload })
          },
        }
      },
    },
  } as unknown as Client
  const schedule = buildSchedule(event as never, 'admin', 48, 'hours')
  return {
    guildId,
    event,
    events,
    sent,
    client,
    schedule,
    setFailSend(value: boolean) {
      failSend = value
    },
  }
}

test('migrates legacy notification configuration without changing the channel', async () => {
  const settings = await eventNotificationStore.get('legacy-guild')
  assert.equal(settings?.channelId, 'legacy-channel')
  assert.equal(settings?.remindBeforeMinutes, 30)
  assert.equal(settings?.roleId, null)
  assert.equal(settings?.enabled, true)
  assert.equal(settings?.messageTemplate, null)
  const individual = await eventNotificationStore.get(
    'legacy-guild',
    'legacy-schedule',
  )
  assert.equal(individual?.messageTemplate, null)
  assert.equal(individual?.roleId, 'legacy-role')
  assert.equal(individual?.remindBeforeMinutes, 60)
  const f = fixture()
  const secondsSchedule = buildSchedule(
    f.event as never,
    'admin',
    900,
    'seconds',
  )
  await recurringEventStore.add(secondsSchedule)
  await recurringEventStore.remove(f.guildId, secondsSchedule.id)
})

test('creation does not announce; original and subsequent occurrences remind at the chosen window', async () => {
  const f = fixture()
  await eventNotificationStore.set(f.guildId, 'activity-channel', 'admin', {
    roleId: 'activity-role',
    remindBeforeMinutes: 30,
  })
  const schedule = await createRecurringSchedule(
    f.client,
    f.event as never,
    'admin',
    48,
    'hours',
  )
  assert.equal(f.sent.length, 0)
  await sendDueEventReminders(f.client)
  assert.equal(f.sent.length, 0)
  now += 30 * minute
  await sendDueEventReminders(f.client)
  assert.equal(f.sent.length, 1)
  assert.equal(f.sent[0].channelId, 'activity-channel')
  assert.match(
    f.sent[0].payload.content,
    /^<@&activity-role>\n\*\*活動即將開始/,
  )
  assert.deepEqual(f.sent[0].payload.allowedMentions, {
    parse: [],
    roles: ['activity-role'],
  })
  assert.ok(f.sent[0].payload.content.includes(f.event.url))
  // Refresh/restart tracking must preserve delivery status.
  await eventReminderStore.track(
    schedule.id,
    f.event.id,
    f.event.scheduledStartTimestamp,
  )
  await sendDueEventReminders(f.client)
  assert.equal(f.sent.length, 1)
  now += 48 * 60 * minute
  await sendDueEventReminders(f.client)
  assert.equal(f.sent.length, 2)
})

test('per-schedule settings override shared settings; disabling does not fall back', async () => {
  const f = fixture(20)
  await recurringEventStore.add(f.schedule)
  await eventReminderStore.track(
    f.schedule.id,
    f.event.id,
    f.event.scheduledStartTimestamp,
  )
  await eventNotificationStore.set(f.guildId, 'shared', 'admin', {
    roleId: 'shared-role',
  })
  await eventNotificationStore.set(f.guildId, 'individual', 'admin', {
    scheduleId: f.schedule.id,
    remindBeforeMinutes: 10,
  })
  await sendDueEventReminders(f.client)
  assert.equal(f.sent.length, 0)
  now += 10 * minute
  await eventNotificationStore.set(f.guildId, '', 'admin', {
    scheduleId: f.schedule.id,
    enabled: false,
  })
  await sendDueEventReminders(f.client)
  assert.equal(f.sent.length, 0)
  await eventNotificationStore.remove(f.guildId, f.schedule.id)
  await sendDueEventReminders(f.client)
  assert.equal(f.sent[0].channelId, 'shared')
  assert.deepEqual(f.sent[0].payload.allowedMentions.roles, ['shared-role'])
})

test('different activities use independent channels and roles', async () => {
  const f = fixture(10)
  const second = { ...f.event, id: 'second-event' }
  f.events.set(second.id, second)
  const secondSchedule = buildSchedule(second as never, 'admin', 24, 'hours')
  for (const [schedule, eventId, channelId, roleId] of [
    [f.schedule, f.event.id, 'channel-a', 'role-a'],
    [secondSchedule, second.id, 'channel-b', 'role-b'],
  ] as const) {
    await recurringEventStore.add(schedule)
    await eventReminderStore.track(
      schedule.id,
      eventId,
      f.event.scheduledStartTimestamp,
    )
    await eventNotificationStore.set(f.guildId, channelId, 'admin', {
      scheduleId: schedule.id,
      roleId,
    })
  }
  await sendDueEventReminders(f.client)
  assert.deepEqual(
    f.sent.map((message) => [
      message.channelId,
      message.payload.allowedMentions.roles,
    ]),
    [
      ['channel-a', ['role-a']],
      ['channel-b', ['role-b']],
    ],
  )
})

test('custom template overrides shared text and only mentions the configured role', async () => {
  const f = fixture(10)
  await recurringEventStore.add(f.schedule)
  await eventReminderStore.track(
    f.schedule.id,
    f.event.id,
    f.event.scheduledStartTimestamp,
  )
  await eventNotificationStore.set(f.guildId, 'shared', 'admin', {
    messageTemplate: '共用：{name}',
  })
  const messageTemplate =
    '{role}\\n🔔 {name}\\n{time} {relative}\\n{url}\\n@everyone <@&other-role> <@123>'
  await eventNotificationStore.set(f.guildId, 'individual', 'admin', {
    scheduleId: f.schedule.id,
    roleId: 'selected-role',
    messageTemplate,
  })
  assert.equal(
    (await eventNotificationStore.resolve(f.guildId, f.schedule.id))
      ?.messageTemplate,
    messageTemplate,
  )
  await sendDueEventReminders(f.client)
  assert.equal(f.sent.length, 1)
  assert.ok(f.sent[0].payload.content.startsWith('<@&selected-role>\n🔔 '))
  assert.ok(f.sent[0].payload.content.includes(f.event.url))
  assert.ok(
    f.sent[0].payload.content.includes('@everyone <@&other-role> <@123>'),
  )
  assert.deepEqual(f.sent[0].payload.allowedMentions, {
    parse: [],
    roles: ['selected-role'],
  })
  await eventNotificationStore.set(f.guildId, 'individual', 'admin', {
    scheduleId: f.schedule.id,
  })
  assert.equal(
    (await eventNotificationStore.resolve(f.guildId, f.schedule.id))
      ?.messageTemplate,
    null,
  )
})

test('scheduler seeds reminders for existing schedules on startup', async () => {
  const f = fixture(10)
  await recurringEventStore.add(f.schedule)
  await eventNotificationStore.set(f.guildId, 'channel', 'admin')
  const stop = startRecurringEventScheduler(f.client)
  try {
    // Wait for the startup refresh and check, without advancing real timers.
    for (let i = 0; i < 100 && f.sent.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.equal(f.sent.length, 1)
    assert.deepEqual(f.sent[0].payload.allowedMentions, {
      parse: [],
      roles: [],
    })
  } finally {
    stop()
  }
})

test('skips started/cancelled events and checks edits before sending', async () => {
  for (const mode of [
    'started',
    'cancelled',
    'deleted',
    'rescheduled',
  ] as const) {
    const f = fixture(10)
    await recurringEventStore.add(f.schedule)
    await eventReminderStore.track(
      f.schedule.id,
      f.event.id,
      f.event.scheduledStartTimestamp,
    )
    await eventNotificationStore.set(f.guildId, 'channel', 'admin')
    if (mode === 'started') now += 11 * minute
    if (mode === 'cancelled')
      f.event.status = GuildScheduledEventStatus.Canceled
    if (mode === 'deleted') f.events.delete(f.event.id)
    if (mode === 'rescheduled')
      f.event.scheduledStartTimestamp = now + 120 * minute
    await sendDueEventReminders(f.client)
    assert.equal(f.sent.length, 0, mode)
    if (mode === 'rescheduled') {
      now += 90 * minute
      await sendDueEventReminders(f.client)
      assert.equal(f.sent.length, 1)
    }
  }
})

test('failed delivery retries, sent records persist in a fresh process, removing a schedule cancels reminders', async () => {
  const f = fixture(10)
  await recurringEventStore.add(f.schedule)
  await eventReminderStore.track(
    f.schedule.id,
    f.event.id,
    f.event.scheduledStartTimestamp,
  )
  await eventNotificationStore.set(f.guildId, 'channel', 'admin', {
    roleId: 'role',
    messageTemplate: '{role} {name} {url}',
  })
  f.setFailSend(true)
  const realError = console.error
  console.error = () => {}
  try {
    await sendDueEventReminders(f.client)
  } finally {
    console.error = realError
  }
  assert.equal(f.sent.length, 0)
  f.setFailSend(false)
  await sendDueEventReminders(f.client)
  assert.equal(f.sent.length, 1)
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
    const {eventReminderStore, eventNotificationStore} = await import('./src/recurring-events/store.ts');
    const {closeDatabases} = await import('./src/database.ts');
    const {dataDirectory} = await import('./src/recurring-events/storage.ts');
    console.log(JSON.stringify({dataDirectory, pending: (await eventReminderStore.pending(${now})).filter(r => r.scheduleId === '${f.schedule.id}'), settings: await eventNotificationStore.get('${f.guildId}')}));
    closeDatabases();
  `,
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...process.env,
        BOT_DATA_DIR: dataDirectory,
        DATABASE_DRIVER: 'sqlite',
      },
    },
  )
  const persisted = JSON.parse(output.trim())
  assert.equal(persisted.dataDirectory, dataDirectory)
  assert.deepEqual(persisted.pending, [])
  assert.equal(persisted.settings.roleId, 'role')
  assert.equal(persisted.settings.messageTemplate, '{role} {name} {url}')
  await eventNotificationStore.set(f.guildId, 'individual', 'admin', {
    scheduleId: f.schedule.id,
  })
  await recurringEventStore.remove(f.guildId, f.schedule.id)
  assert.equal(await eventNotificationStore.get(f.guildId, f.schedule.id), null)
  assert.ok(
    !(await eventReminderStore.pending(now)).some(
      (r) => r.scheduleId === f.schedule.id,
    ),
  )
})

test('command validates Manage Events and role mention permission before saving', async () => {
  for (const mode of [
    'unauthorized',
    'cannot-mention',
    'valid',
    'custom',
    'invalid-message',
  ] as const) {
    const guildId = `permissions-${mode}`
    const responses: string[] = []
    const previews: Array<{
      content: string
      allowedMentions: { parse: string[] }
    }> = []
    const canMention = ['valid', 'custom', 'invalid-message'].includes(mode)
    const role = { id: 'role', mentionable: false, toString: () => '<@&role>' }
    const channel = {
      id: 'channel',
      guildId,
      type: 0,
      toString: () => '<#channel>',
      permissionsFor: () => ({
        has: (permission: unknown) => Array.isArray(permission) || canMention,
      }),
    }
    const interaction = {
      inCachedGuild: () => true,
      guildId,
      user: { id: 'admin' },
      guild: { members: { me: {} }, roles: { fetch: async () => role } },
      memberPermissions: {
        has: (permission: bigint) =>
          permission === PermissionFlagsBits.ManageEvents &&
          mode !== 'unauthorized',
      },
      options: {
        getSubcommand: () => 'notify',
        getString: (name: string) =>
          name === 'message'
            ? mode === 'custom'
              ? '{role}\\n集合！{name}\\n{url}'
              : mode === 'invalid-message'
                ? '{wrong}'
                : null
            : null,
        getInteger: () => 60,
        getChannel: () => channel,
        getRole: () => role,
      },
      reply: async (payload: { content: string }) => {
        responses.push(payload.content)
      },
      deferReply: async () => {},
      editReply: async (content: string) => {
        responses.push(content)
      },
      followUp: async (payload: (typeof previews)[number]) => {
        previews.push(payload)
      },
    }
    await eventCommand.execute(interaction as never)
    const settings = await eventNotificationStore.get(guildId)
    assert.equal(settings !== null, mode === 'valid' || mode === 'custom')
    if (mode === 'unauthorized') assert.match(responses[0], /管理活動/)
    if (mode === 'cannot-mention') assert.match(responses[0], /無法標註/)
    if (mode === 'valid') assert.equal(settings?.remindBeforeMinutes, 60)
    if (mode === 'invalid-message') assert.match(responses[0], /不支援/)
    if (mode === 'custom') {
      assert.equal(settings?.messageTemplate, '{role}\\n集合！{name}\\n{url}')
      assert.equal(previews.length, 1)
      assert.match(previews[0].content, /^<@&role>\n集合！活動名稱/)
      assert.deepEqual(previews[0].allowedMentions, { parse: [] })
    }
  }
})
