import { existsSync, readFileSync, renameSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
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

const database = new DatabaseSync(dataFile('recurring-events.sqlite'))
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
`)

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
  );
`

database.exec(createTableSql)

const schema = database
  .prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'recurring_events'`,
  )
  .get() as { sql: string }

if (!schema.sql.includes("'seconds'")) {
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE recurring_events RENAME TO recurring_events_previous;
      ${createTableSql}
      INSERT INTO recurring_events (
        id, guild_id, source_event_id, latest_event_id, created_by,
        created_at, interval_value, unit, next_start_at, template_json
      )
      SELECT id, guild_id, source_event_id, latest_event_id, created_by,
             created_at, interval_value, unit, next_start_at, template_json
      FROM recurring_events_previous;
      DROP TABLE recurring_events_previous;
      COMMIT;
    `)
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // SQLite may already have rolled back the transaction.
    }
    throw error
  }
}

database.exec('PRAGMA user_version = 2')

const listAllStatement = database.prepare(`
  SELECT id, guild_id, source_event_id, latest_event_id, created_by,
         created_at, interval_value, unit, next_start_at, template_json
  FROM recurring_events
  ORDER BY created_at
`)
const listGuildStatement = database.prepare(`
  SELECT id, guild_id, source_event_id, latest_event_id, created_by,
         created_at, interval_value, unit, next_start_at, template_json
  FROM recurring_events
  WHERE guild_id = ?
  ORDER BY created_at
`)
const insertStatement = database.prepare(`
  INSERT INTO recurring_events (
    id, guild_id, source_event_id, latest_event_id, created_by,
    created_at, interval_value, unit, next_start_at, template_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertIfMissingStatement = database.prepare(`
  INSERT OR IGNORE INTO recurring_events (
    id, guild_id, source_event_id, latest_event_id, created_by,
    created_at, interval_value, unit, next_start_at, template_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const updateStatement = database.prepare(`
  UPDATE recurring_events
  SET latest_event_id = ?, interval_value = ?, unit = ?, next_start_at = ?,
      template_json = ?
  WHERE id = ?
`)
const removeStatement = database.prepare(`
  DELETE FROM recurring_events WHERE guild_id = ? AND id = ?
`)

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

function migrateJsonStore(): void {
  const jsonFile = dataFile('recurring-events.json')
  if (!existsSync(jsonFile)) return

  try {
    const schedules = JSON.parse(
      readFileSync(jsonFile, 'utf8'),
    ) as RecurringEventSchedule[]
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const schedule of schedules) {
        insertIfMissingStatement.run(...scheduleValues(schedule))
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    renameSync(jsonFile, dataFile('recurring-events.migrated.json'))
    console.log(`[events] Migrated ${schedules.length} schedule(s) to SQLite`)
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    console.error(`[events] Failed to migrate JSON schedule store: ${details}`)
  }
}

migrateJsonStore()

export const recurringEventStore = {
  async list(guildId?: string): Promise<RecurringEventSchedule[]> {
    const rows = (guildId
      ? listGuildStatement.all(guildId)
      : listAllStatement.all()) as unknown as ScheduleRow[]
    return rows.map(toSchedule)
  },

  async add(schedule: RecurringEventSchedule): Promise<void> {
    try {
      insertStatement.run(...scheduleValues(schedule))
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
    updateStatement.run(
      schedule.latestEventId,
      schedule.interval,
      schedule.unit,
      schedule.nextStartAt,
      JSON.stringify(schedule.template),
      schedule.id,
    )
  },

  async remove(guildId: string, id: string): Promise<boolean> {
    const result = removeStatement.run(guildId, id)
    return Number(result.changes) > 0
  },
}
