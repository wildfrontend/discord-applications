import { configureDatabase, createDatabase } from '../database.js'

const database = createDatabase('consultation.sqlite')
await configureDatabase(database)
await database.execute(`CREATE TABLE IF NOT EXISTS consultation_channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT PRIMARY KEY,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`)
await database.execute(`CREATE TABLE IF NOT EXISTS consultation_usage (
  day TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
)`)

export const consultationUsageStore = {
  async get(day: string, userId: string) {
    const result = await database.execute({
      sql: `SELECT COALESCE(SUM(count), 0) AS bot_count,
        COALESCE(SUM(CASE WHEN user_id = ? THEN count ELSE 0 END), 0) AS user_count
        FROM consultation_usage WHERE day = ?`,
      args: [userId, day],
    })
    return {
      user: Number(result.rows[0]?.user_count ?? 0),
      bot: Number(result.rows[0]?.bot_count ?? 0),
    }
  },
  async claim(
    day: string,
    userId: string,
    userLimit: number,
    botLimit: number,
  ): Promise<boolean> {
    // One conditional write makes checking and reserving both quotas atomic.
    const result = await database.execute({
      sql: `INSERT INTO consultation_usage (day, user_id, count)
        SELECT ?, ?, 1 WHERE
          COALESCE((SELECT count FROM consultation_usage WHERE day = ? AND user_id = ?), 0) < ?
          AND COALESCE((SELECT SUM(count) FROM consultation_usage WHERE day = ?), 0) < ?
        ON CONFLICT(day, user_id) DO UPDATE SET count = count + 1`,
      args: [day, userId, day, userId, userLimit, day, botLimit],
    })
    return result.rowsAffected > 0
  },
}

export const consultationChannelStore = {
  async has(guildId: string, channelId: string): Promise<boolean> {
    const result = await database.execute({
      sql: 'SELECT channel_id FROM consultation_channels WHERE guild_id = ? AND channel_id = ?',
      args: [guildId, channelId],
    })
    return result.rows.length > 0
  },
  async set(
    guildId: string,
    channelId: string,
    updatedBy: string,
  ): Promise<void> {
    await database.execute({
      sql: `INSERT INTO consultation_channels (guild_id, channel_id, updated_by, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET
        guild_id = excluded.guild_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      args: [guildId, channelId, updatedBy, new Date().toISOString()],
    })
  },
  async remove(guildId: string, channelId: string): Promise<boolean> {
    const result = await database.execute({
      sql: 'DELETE FROM consultation_channels WHERE guild_id = ? AND channel_id = ?',
      args: [guildId, channelId],
    })
    return result.rowsAffected > 0
  },
}
