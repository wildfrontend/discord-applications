import { randomUUID } from 'node:crypto'
import { configureDatabase, createDatabase } from '../database.js'
import type { TowerArea, TowerObservation, TowerTimeBasis } from './service.js'

export interface TowerBinding {
  id: string
  guildId: string
  channelId: string
  serverNumber: number
}

const database = createDatabase('towers.sqlite')
await configureDatabase(database)
await database.batch(
  [
    `CREATE TABLE IF NOT EXISTS tower_user_locales (
      user_id TEXT PRIMARY KEY,
      locale TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tower_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    binding_id TEXT NOT NULL UNIQUE,
    server_number INTEGER NOT NULL CHECK (server_number BETWEEN 1 AND 999999),
    updated_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS tower_observations (
    binding_id TEXT NOT NULL,
    area INTEGER NOT NULL CHECK (area IN (7,8,9,12,14,17,18,19)),
    server_number INTEGER NOT NULL,
    occupying_tribe TEXT NOT NULL,
    remaining_seconds INTEGER NOT NULL CHECK (remaining_seconds BETWEEN 0 AND 172800),
    observed_at INTEGER NOT NULL,
    available_at INTEGER NOT NULL,
    source_message_id TEXT NOT NULL,
    source_attachment_id TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL DEFAULT 0,
    time_basis TEXT NOT NULL DEFAULT 'upload',
    clock_time TEXT,
    clock_is_utc INTEGER,
    PRIMARY KEY (binding_id, area)
  )`,
  ],
  'write',
)

const observationColumns = await database.execute(
  'PRAGMA table_info(tower_observations)',
)
for (const [name, definition] of [
  ['uploaded_at', 'INTEGER NOT NULL DEFAULT 0'],
  ['time_basis', "TEXT NOT NULL DEFAULT 'upload'"],
  ['clock_time', 'TEXT'],
  ['clock_is_utc', 'INTEGER'],
] as const) {
  if (!observationColumns.rows.some((row) => row.name === name)) {
    await database.execute(
      `ALTER TABLE tower_observations ADD COLUMN ${name} ${definition}`,
    )
  }
}
await database.execute(
  'UPDATE tower_observations SET uploaded_at = observed_at WHERE uploaded_at = 0',
)

export const towerStore = {
  async rememberLocale(
    userId: string,
    locale: string,
    observedAt = Date.now(),
  ): Promise<void> {
    await database.execute({
      sql: `INSERT INTO tower_user_locales (user_id, locale, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET locale = excluded.locale, updated_at = excluded.updated_at
        WHERE excluded.updated_at >= tower_user_locales.updated_at`,
      args: [userId, locale, observedAt],
    })
  },

  async getLocale(userId: string): Promise<string | null> {
    const result = await database.execute({
      sql: 'SELECT locale FROM tower_user_locales WHERE user_id = ?',
      args: [userId],
    })
    return result.rows[0] ? String(result.rows[0].locale) : null
  },
  async getBinding(
    guildId: string,
    channelId: string,
  ): Promise<TowerBinding | null> {
    const result = await database.execute({
      sql: `SELECT binding_id, server_number FROM tower_channels WHERE guild_id = ? AND channel_id = ?`,
      args: [guildId, channelId],
    })
    const row = result.rows[0]
    return row
      ? {
          id: String(row.binding_id),
          guildId,
          channelId,
          serverNumber: Number(row.server_number),
        }
      : null
  },

  async bind(
    guildId: string,
    channelId: string,
    serverNumber: number,
    updatedBy: string,
  ): Promise<void> {
    await database.batch(
      [
        {
          sql: `INSERT INTO tower_channels (channel_id, guild_id, binding_id, server_number, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(channel_id) DO UPDATE SET
            binding_id = CASE WHEN tower_channels.server_number = excluded.server_number
              AND tower_channels.guild_id = excluded.guild_id THEN tower_channels.binding_id ELSE excluded.binding_id END,
            guild_id = excluded.guild_id, server_number = excluded.server_number,
            updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          args: [
            channelId,
            guildId,
            randomUUID(),
            serverNumber,
            updatedBy,
            Date.now(),
          ],
        },
        `DELETE FROM tower_observations WHERE binding_id NOT IN (SELECT binding_id FROM tower_channels)`,
      ],
      'write',
    )
  },

  async disable(guildId: string, channelId: string): Promise<void> {
    await database.batch(
      [
        {
          sql: `DELETE FROM tower_channels WHERE guild_id = ? AND channel_id = ?`,
          args: [guildId, channelId],
        },
        `DELETE FROM tower_observations WHERE binding_id NOT IN (SELECT binding_id FROM tower_channels)`,
      ],
      'write',
    )
  },

  async save(binding: TowerBinding, item: TowerObservation): Promise<boolean> {
    // The binding check also rejects AI work that finished after a channel was rebound/disabled.
    const result = await database.execute({
      sql: `INSERT INTO tower_observations (binding_id, area, server_number, occupying_tribe,
          remaining_seconds, observed_at, available_at, source_message_id, source_attachment_id,
          uploaded_at, time_basis, clock_time, clock_is_utc)
        SELECT binding_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM tower_channels
        WHERE binding_id = ? AND guild_id = ? AND channel_id = ? AND server_number = ?
        ON CONFLICT(binding_id, area) DO UPDATE SET
          occupying_tribe = excluded.occupying_tribe, remaining_seconds = excluded.remaining_seconds,
          observed_at = excluded.observed_at, available_at = excluded.available_at,
          source_message_id = excluded.source_message_id, source_attachment_id = excluded.source_attachment_id,
          uploaded_at = excluded.uploaded_at, time_basis = excluded.time_basis,
          clock_time = excluded.clock_time, clock_is_utc = excluded.clock_is_utc
        WHERE (excluded.observed_at / 60000) > (tower_observations.observed_at / 60000) OR
          ((excluded.observed_at / 60000) = (tower_observations.observed_at / 60000) AND
            (excluded.uploaded_at > tower_observations.uploaded_at OR
              (excluded.uploaded_at = tower_observations.uploaded_at AND excluded.source_attachment_id > tower_observations.source_attachment_id)))`,
      args: [
        item.area,
        item.serverNumber,
        item.occupyingTribe,
        item.remainingSeconds,
        item.observedAt,
        item.availableAt,
        item.sourceMessageId,
        item.sourceAttachmentId,
        item.uploadedAt,
        item.timeBasis,
        item.clock?.time ?? null,
        item.clock ? (item.clock.isUtc ? 1 : 0) : null,
        binding.id,
        binding.guildId,
        binding.channelId,
        item.serverNumber,
      ],
    })
    return result.rowsAffected > 0
  },

  async list(binding: TowerBinding): Promise<TowerObservation[]> {
    const result = await database.execute({
      sql: 'SELECT * FROM tower_observations WHERE binding_id = ? ORDER BY area',
      args: [binding.id],
    })
    return result.rows.map((row) => ({
      serverNumber: Number(row.server_number),
      area: Number(row.area) as TowerArea,
      occupyingTribe: String(row.occupying_tribe),
      remainingSeconds: Number(row.remaining_seconds),
      observedAt: Number(row.observed_at),
      uploadedAt: Number(row.uploaded_at),
      timeBasis: String(row.time_basis) as TowerTimeBasis,
      availableAt: Number(row.available_at),
      sourceMessageId: String(row.source_message_id),
      sourceAttachmentId: String(row.source_attachment_id),
      ...(typeof row.clock_time === 'string' && row.clock_is_utc !== null
        ? {
            clock: {
              time: row.clock_time,
              isUtc: Number(row.clock_is_utc) === 1,
            },
          }
        : {}),
    }))
  },
}
