import { existsSync, readFileSync, renameSync } from 'node:fs'
import {
  configureDatabase,
  createDatabase,
  databaseDriver,
} from '../database.js'
import { validateReminderTemplate } from './message-template.js'
import { dataFile } from './storage.js'
import type { RecurrenceUnit, RecurringEventSchedule } from './types.js'

interface ScheduleRow {
  id: string
  guild_id: string
  source_event_id: string
  latest_event_id: string
  created_by: string
  created_at: string
  interval_value: number
  unit: RecurrenceUnit
  next_start_at: string
  template_json: string
}

export interface EventNotificationSettings {
  guildId: string
  channelId: string
  roleId: string | null
  messageTemplate: string | null
  /** 0 代表不在開始前提醒。 */
  remindBeforeMinutes: number
  remindBeforeEndMinutes: number | null
  repeatEveryMinutes: number | null
  enabled: boolean
  updatedBy: string
  updatedAt: string
}

interface NotificationSettingsRow {
  guild_id: string
  channel_id: string
  role_id: string | null
  message_template: string | null
  remind_before_minutes: number
  remind_before_end_minutes: number | null
  repeat_every_minutes: number | null
  enabled?: number
  updated_by: string
  updated_at: string
}

const database = createDatabase('recurring-events.sqlite')
await configureDatabase(database)

const createTableSql = `
  CREATE TABLE IF NOT EXISTS recurring_events (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    latest_event_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    interval_value INTEGER NOT NULL CHECK (interval_value > 0),
    unit TEXT NOT NULL CHECK (
      unit IN ('seconds', 'minutes', 'hours', 'days', 'weeks')
    ),
    next_start_at TEXT NOT NULL,
    template_json TEXT NOT NULL,
    UNIQUE (guild_id, source_event_id)
  )
`

await database.batch(
  [
    createTableSql,
    `CREATE TABLE IF NOT EXISTS event_notification_settings (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
  'write',
)

// 舊版共用通知設定沿用頻道，改為預設提前 30 分鐘提醒。
const notificationColumns = await database.execute(
  'PRAGMA table_info(event_notification_settings)',
)
for (const [name, definition] of [
  ['role_id', 'TEXT'],
  ['message_template', 'TEXT'],
  ['remind_before_minutes', 'INTEGER NOT NULL DEFAULT 30'],
  ['remind_before_end_minutes', 'INTEGER'],
  ['repeat_every_minutes', 'INTEGER'],
]) {
  if (!notificationColumns.rows.some((row) => row.name === name)) {
    await database.execute(
      `ALTER TABLE event_notification_settings ADD COLUMN ${name} ${definition}`,
    )
  }
}
await database.batch(
  [
    `CREATE TABLE IF NOT EXISTS event_schedule_notifications (
      schedule_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      role_id TEXT,
      message_template TEXT,
      remind_before_minutes INTEGER NOT NULL DEFAULT 30,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS event_reminders (
      schedule_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      start_at INTEGER NOT NULL,
      sent_at TEXT,
      PRIMARY KEY (schedule_id, event_id)
    )`,
  ],
  'write',
)

const scheduleNotificationColumns = await database.execute(
  'PRAGMA table_info(event_schedule_notifications)',
)
for (const name of [
  'message_template',
  'remind_before_end_minutes',
  'repeat_every_minutes',
]) {
  if (!scheduleNotificationColumns.rows.some((row) => row.name === name)) {
    const type = name === 'message_template' ? 'TEXT' : 'INTEGER'
    await database.execute(
      `ALTER TABLE event_schedule_notifications ADD COLUMN ${name} ${type}`,
    )
  }
}

// 同一場活動可能有開始前、進行中、結束前多次提醒，記錄最後送出的提醒時間點。
const reminderColumns = await database.execute(
  'PRAGMA table_info(event_reminders)',
)
for (const name of ['end_at', 'last_trigger_at']) {
  if (!reminderColumns.rows.some((row) => row.name === name)) {
    await database.execute(
      `ALTER TABLE event_reminders ADD COLUMN ${name} INTEGER`,
    )
  }
}

const schemaResult = await database.execute(
  `SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'recurring_events'`,
)
const schemaSql = schemaResult.rows[0]?.sql

if (typeof schemaSql === 'string' && !schemaSql.includes("'seconds'")) {
  await database.batch(
    [
      'ALTER TABLE recurring_events RENAME TO recurring_events_previous',
      createTableSql,
      `INSERT INTO recurring_events (
        id, guild_id, source_event_id, latest_event_id, created_by,
        created_at, interval_value, unit, next_start_at, template_json
      )
      SELECT id, guild_id, source_event_id, latest_event_id, created_by,
             created_at, interval_value, unit, next_start_at, template_json
      FROM recurring_events_previous`,
      'DROP TABLE recurring_events_previous',
    ],
    'write',
  )
}

const listAllSql = `
  SELECT id, guild_id, source_event_id, latest_event_id, created_by,
         created_at, interval_value, unit, next_start_at, template_json
  FROM recurring_events
  ORDER BY created_at
`
const listGuildSql = `
  SELECT id, guild_id, source_event_id, latest_event_id, created_by,
         created_at, interval_value, unit, next_start_at, template_json
  FROM recurring_events
  WHERE guild_id = ?
  ORDER BY created_at
`
const insertSql = `
  INSERT INTO recurring_events (
    id, guild_id, source_event_id, latest_event_id, created_by,
    created_at, interval_value, unit, next_start_at, template_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
const insertIfMissingSql = `
  INSERT OR IGNORE INTO recurring_events (
    id, guild_id, source_event_id, latest_event_id, created_by,
    created_at, interval_value, unit, next_start_at, template_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
const updateSql = `
  UPDATE recurring_events
  SET latest_event_id = ?, interval_value = ?, unit = ?, next_start_at = ?,
      template_json = ?
  WHERE id = ?
`

function toSchedule(row: ScheduleRow): RecurringEventSchedule {
  return {
    id: row.id,
    guildId: row.guild_id,
    sourceEventId: row.source_event_id,
    latestEventId: row.latest_event_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    interval: row.interval_value,
    unit: row.unit,
    nextStartAt: row.next_start_at,
    template: JSON.parse(
      row.template_json,
    ) as RecurringEventSchedule['template'],
  }
}

function scheduleValues(schedule: RecurringEventSchedule) {
  return [
    schedule.id,
    schedule.guildId,
    schedule.sourceEventId,
    schedule.latestEventId,
    schedule.createdBy,
    schedule.createdAt,
    schedule.interval,
    schedule.unit,
    schedule.nextStartAt,
    JSON.stringify(schedule.template),
  ] as const
}

async function migrateJsonStore(): Promise<void> {
  if (databaseDriver !== 'sqlite') return
  const jsonFile = dataFile('recurring-events.json')
  if (!existsSync(jsonFile)) return

  try {
    const schedules = JSON.parse(
      readFileSync(jsonFile, 'utf8'),
    ) as RecurringEventSchedule[]
    await database.batch(
      schedules.map((schedule) => ({
        sql: insertIfMissingSql,
        args: [...scheduleValues(schedule)],
      })),
      'write',
    )
    renameSync(jsonFile, dataFile('recurring-events.migrated.json'))
    console.log(`[events] Migrated ${schedules.length} schedule(s) to SQLite`)
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    console.error(`[events] Failed to migrate JSON schedule store: ${details}`)
  }
}

await migrateJsonStore()

export const recurringEventStore = {
  async list(guildId?: string): Promise<RecurringEventSchedule[]> {
    const result = guildId
      ? await database.execute({ sql: listGuildSql, args: [guildId] })
      : await database.execute(listAllSql)
    return (result.rows as unknown as ScheduleRow[]).map(toSchedule)
  },

  async add(schedule: RecurringEventSchedule): Promise<void> {
    try {
      await database.execute({
        sql: insertSql,
        args: [...scheduleValues(schedule)],
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        throw new Error('這個活動已設定自訂重複規則。')
      }
      throw error
    }
  },

  async update(schedule: RecurringEventSchedule): Promise<void> {
    await database.execute({
      sql: updateSql,
      args: [
        schedule.latestEventId,
        schedule.interval,
        schedule.unit,
        schedule.nextStartAt,
        JSON.stringify(schedule.template),
        schedule.id,
      ],
    })
  },

  async remove(guildId: string, id: string): Promise<boolean> {
    const results = await database.batch(
      [
        {
          sql: `DELETE FROM event_reminders WHERE schedule_id IN
          (SELECT id FROM recurring_events WHERE guild_id = ? AND id = ?)`,
          args: [guildId, id],
        },
        {
          sql: 'DELETE FROM event_schedule_notifications WHERE guild_id = ? AND schedule_id = ?',
          args: [guildId, id],
        },
        {
          sql: 'DELETE FROM recurring_events WHERE guild_id = ? AND id = ?',
          args: [guildId, id],
        },
      ],
      'write',
    )
    return results[2].rowsAffected > 0
  },
}

function toSettings(row: NotificationSettingsRow): EventNotificationSettings {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    roleId: row.role_id,
    messageTemplate: row.message_template,
    remindBeforeMinutes: row.remind_before_minutes,
    remindBeforeEndMinutes: row.remind_before_end_minutes ?? null,
    repeatEveryMinutes: row.repeat_every_minutes ?? null,
    enabled: row.enabled !== 0,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

const NATIVE_SCHEDULE_PREFIX = 'native:'

/** Discord 原生重複活動沒有本地排程，以活動 ID 作為提醒設定的 key。 */
export function nativeScheduleId(eventId: string): string {
  return `${NATIVE_SCHEDULE_PREFIX}${eventId}`
}

export function nativeEventId(scheduleId: string): string | null {
  return scheduleId.startsWith(NATIVE_SCHEDULE_PREFIX)
    ? scheduleId.slice(NATIVE_SCHEDULE_PREFIX.length)
    : null
}

export const eventNotificationStore = {
  async get(
    guildId: string,
    scheduleId?: string,
  ): Promise<EventNotificationSettings | null> {
    const result = await database.execute({
      sql: scheduleId
        ? `SELECT * FROM event_schedule_notifications WHERE guild_id = ? AND schedule_id = ?`
        : `SELECT guild_id, channel_id, role_id, message_template, remind_before_minutes,
          remind_before_end_minutes, repeat_every_minutes, updated_by, updated_at
        FROM event_notification_settings
        WHERE guild_id = ?`,
      args: scheduleId ? [guildId, scheduleId] : [guildId],
    })
    const row = result.rows[0] as unknown as NotificationSettingsRow | undefined
    return row ? toSettings(row) : null
  },

  async resolve(
    guildId: string,
    scheduleId: string,
  ): Promise<EventNotificationSettings | null> {
    return (await this.get(guildId, scheduleId)) ?? this.get(guildId)
  },

  async set(
    guildId: string,
    channelId: string,
    updatedBy: string,
    options: {
      scheduleId?: string
      roleId?: string | null
      messageTemplate?: string | null
      remindBeforeMinutes?: number
      remindBeforeEndMinutes?: number | null
      repeatEveryMinutes?: number | null
      enabled?: boolean
    } = {},
  ): Promise<EventNotificationSettings> {
    const settings: EventNotificationSettings = {
      guildId,
      channelId,
      roleId: options.roleId ?? null,
      messageTemplate: options.messageTemplate ?? null,
      remindBeforeMinutes: options.remindBeforeMinutes ?? 30,
      remindBeforeEndMinutes: options.remindBeforeEndMinutes ?? null,
      repeatEveryMinutes: options.repeatEveryMinutes ?? null,
      enabled: options.enabled ?? true,
      updatedBy,
      updatedAt: new Date().toISOString(),
    }
    if (settings.messageTemplate !== null) {
      validateReminderTemplate(settings.messageTemplate, settings.roleId)
    }
    await database.execute({
      sql: options.scheduleId
        ? `INSERT INTO event_schedule_notifications (
          schedule_id, guild_id, channel_id, role_id, message_template, remind_before_minutes,
          remind_before_end_minutes, repeat_every_minutes, enabled, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(schedule_id) DO UPDATE SET
          channel_id = excluded.channel_id, role_id = excluded.role_id,
          message_template = excluded.message_template,
          remind_before_minutes = excluded.remind_before_minutes,
          remind_before_end_minutes = excluded.remind_before_end_minutes,
          repeat_every_minutes = excluded.repeat_every_minutes, enabled = excluded.enabled,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at`
        : `INSERT INTO event_notification_settings (
          guild_id, channel_id, role_id, message_template, remind_before_minutes,
          remind_before_end_minutes, repeat_every_minutes, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
          channel_id = excluded.channel_id,
          role_id = excluded.role_id,
          message_template = excluded.message_template,
          remind_before_minutes = excluded.remind_before_minutes,
          remind_before_end_minutes = excluded.remind_before_end_minutes,
          repeat_every_minutes = excluded.repeat_every_minutes,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at`,
      args: [
        ...(options.scheduleId ? [options.scheduleId] : []),
        settings.guildId,
        settings.channelId,
        settings.roleId,
        settings.messageTemplate,
        settings.remindBeforeMinutes,
        settings.remindBeforeEndMinutes,
        settings.repeatEveryMinutes,
        ...(options.scheduleId ? [Number(settings.enabled)] : []),
        settings.updatedBy,
        settings.updatedAt,
      ],
    })
    // 修改提醒時間後，尚未結束的活動要依新設定繼續提醒。
    await database.execute({
      sql: `UPDATE event_reminders SET sent_at = NULL
        WHERE sent_at IS NOT NULL AND last_trigger_at IS NOT NULL
          AND COALESCE(end_at, start_at) > ?
          AND schedule_id IN (${
            options.scheduleId
              ? '?'
              : 'SELECT id FROM recurring_events WHERE guild_id = ?'
          })`,
      args: [Date.now(), options.scheduleId ?? guildId],
    })
    return settings
  },

  async listNative(
    guildId?: string,
  ): Promise<Array<EventNotificationSettings & { eventId: string }>> {
    const result = await database.execute({
      sql: `SELECT * FROM event_schedule_notifications
        WHERE schedule_id LIKE '${NATIVE_SCHEDULE_PREFIX}%'${guildId ? ' AND guild_id = ?' : ''}
        ORDER BY updated_at`,
      args: guildId ? [guildId] : [],
    })
    return (
      result.rows as unknown as Array<
        NotificationSettingsRow & { schedule_id: string }
      >
    ).map((row) => ({
      ...toSettings(row),
      eventId: row.schedule_id.slice(NATIVE_SCHEDULE_PREFIX.length),
    }))
  },

  async remove(guildId: string, scheduleId?: string): Promise<boolean> {
    const results = await database.batch(
      [
        // 原生重複活動只靠個別設定登記，移除設定時一併取消待發送提醒。
        ...(scheduleId && nativeEventId(scheduleId)
          ? [
              {
                sql: `DELETE FROM event_reminders WHERE schedule_id IN
                (SELECT schedule_id FROM event_schedule_notifications
                  WHERE guild_id = ? AND schedule_id = ?)`,
                args: [guildId, scheduleId],
              },
            ]
          : []),
        {
          sql: scheduleId
            ? 'DELETE FROM event_schedule_notifications WHERE guild_id = ? AND schedule_id = ?'
            : 'DELETE FROM event_notification_settings WHERE guild_id = ?',
          args: scheduleId ? [guildId, scheduleId] : [guildId],
        },
      ],
      'write',
    )
    return (results.at(-1)?.rowsAffected ?? 0) > 0
  },
}

export const eventReminderStore = {
  async track(
    scheduleId: string,
    eventId: string,
    startAt: number,
    endAt: number | null = null,
  ): Promise<void> {
    await database.execute({
      sql: `INSERT INTO event_reminders (schedule_id, event_id, start_at, end_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(schedule_id, event_id)
        DO UPDATE SET start_at = excluded.start_at, end_at = excluded.end_at`,
      args: [scheduleId, eventId, startAt, endAt],
    })
  },

  /**
   * 原生重複活動每一場都沿用同一個活動 ID，開始時間改變即視為新場次，
   * 需要重置發送紀錄。
   */
  async trackOccurrence(
    scheduleId: string,
    eventId: string,
    startAt: number,
    endAt: number | null = null,
  ): Promise<void> {
    await database.execute({
      sql: `INSERT INTO event_reminders (schedule_id, event_id, start_at, end_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(schedule_id, event_id)
        DO UPDATE SET
          sent_at = CASE WHEN event_reminders.start_at = excluded.start_at
            THEN event_reminders.sent_at ELSE NULL END,
          start_at = excluded.start_at, end_at = excluded.end_at`,
      args: [scheduleId, eventId, startAt, endAt],
    })
  },

  async pending(now: number): Promise<
    Array<{
      scheduleId: string
      guildId: string
      eventId: string
      startAt: number
      endAt: number | null
      lastTriggerAt: number | null
    }>
  > {
    const result = await database.execute({
      sql: `SELECT r.schedule_id, COALESCE(s.guild_id, n.guild_id) AS guild_id,
               r.event_id, r.start_at, r.end_at, r.last_trigger_at
        FROM event_reminders r
        LEFT JOIN recurring_events s ON s.id = r.schedule_id
        LEFT JOIN event_schedule_notifications n
          ON n.schedule_id = r.schedule_id AND r.schedule_id LIKE '${NATIVE_SCHEDULE_PREFIX}%'
        WHERE r.sent_at IS NULL
          AND (r.start_at > ? OR r.end_at > ?
            OR (r.end_at IS NULL AND r.start_at > ?))
          AND COALESCE(s.guild_id, n.guild_id) IS NOT NULL`,
      // 沒有結束時間的活動最多在開始後一天內持續提醒。
      args: [now, now, now - 24 * 60 * 60_000],
    })
    return result.rows.map((row) => ({
      scheduleId: String(row.schedule_id),
      guildId: String(row.guild_id),
      eventId: String(row.event_id),
      startAt: Number(row.start_at),
      endAt: row.end_at === null ? null : Number(row.end_at),
      lastTriggerAt:
        row.last_trigger_at === null ? null : Number(row.last_trigger_at),
    }))
  },

  async markTriggered(
    scheduleId: string,
    eventId: string,
    triggerAt: number,
  ): Promise<void> {
    await database.execute({
      sql: 'UPDATE event_reminders SET last_trigger_at = ? WHERE schedule_id = ? AND event_id = ?',
      args: [triggerAt, scheduleId, eventId],
    })
  },

  async complete(scheduleId: string, eventId: string): Promise<void> {
    await database.execute({
      sql: 'UPDATE event_reminders SET sent_at = ? WHERE schedule_id = ? AND event_id = ?',
      args: [new Date().toISOString(), scheduleId, eventId],
    })
  },
}
