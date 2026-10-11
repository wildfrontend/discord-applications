import { existsSync, readFileSync, renameSync } from 'node:fs'
import {
  configureDatabase,
  createDatabase,
  databaseDriver,
} from '../database.js'
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
  updatedBy: string
  updatedAt: string
}

interface NotificationSettingsRow {
  guild_id: string
  channel_id: string
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
    const result = await database.execute({
      sql: 'DELETE FROM recurring_events WHERE guild_id = ? AND id = ?',
      args: [guildId, id],
    })
    return result.rowsAffected > 0
  },
}

export const eventNotificationStore = {
  async get(guildId: string): Promise<EventNotificationSettings | null> {
    const result = await database.execute({
      sql: `SELECT guild_id, channel_id, updated_by, updated_at
        FROM event_notification_settings
        WHERE guild_id = ?`,
      args: [guildId],
    })
    const row = result.rows[0] as unknown as NotificationSettingsRow | undefined
    return row
      ? {
          guildId: row.guild_id,
          channelId: row.channel_id,
          updatedBy: row.updated_by,
          updatedAt: row.updated_at,
        }
      : null
  },

  async set(
    guildId: string,
    channelId: string,
    updatedBy: string,
  ): Promise<EventNotificationSettings> {
    const settings: EventNotificationSettings = {
      guildId,
      channelId,
      updatedBy,
      updatedAt: new Date().toISOString(),
    }
    await database.execute({
      sql: `INSERT INTO event_notification_settings (
          guild_id, channel_id, updated_by, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
          channel_id = excluded.channel_id,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at`,
      args: [
        settings.guildId,
        settings.channelId,
        settings.updatedBy,
        settings.updatedAt,
      ],
    })
    return settings
  },

  async remove(guildId: string): Promise<boolean> {
    const result = await database.execute({
      sql: 'DELETE FROM event_notification_settings WHERE guild_id = ?',
      args: [guildId],
    })
    return result.rowsAffected > 0
  },
}
