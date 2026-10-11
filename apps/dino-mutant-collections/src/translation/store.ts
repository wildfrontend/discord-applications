import { configureDatabase, createDatabase } from '../database.js'
import type { TranslationLanguage } from './languages.js'

export interface TranslationBinding {
  guildId: string
  channelId: string
  languageA: TranslationLanguage
  languageB: TranslationLanguage
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface TranslationChannelLink {
  guildId: string
  channelAId: string
  languageA: TranslationLanguage
  channelBId: string
  languageB: TranslationLanguage
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface TranslationGroupMember {
  guildId: string
  categoryId: string
  channelId: string
  language: TranslationLanguage
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface TranslationPreference {
  userId: string
  language: TranslationLanguage
  updatedAt: string
}

interface BindingRow {
  guild_id: string
  channel_id: string
  language_a: TranslationLanguage
  language_b: TranslationLanguage
  created_by: string
  created_at: string
  updated_at: string
}

interface ChannelLinkRow {
  guild_id: string
  channel_a_id: string
  language_a: TranslationLanguage
  channel_b_id: string
  language_b: TranslationLanguage
  created_by: string
  created_at: string
  updated_at: string
}

interface GroupMemberRow {
  guild_id: string
  category_id: string
  channel_id: string
  language: TranslationLanguage
  created_by: string
  created_at: string
  updated_at: string
}

interface PreferenceRow {
  user_id: string
  language: TranslationLanguage
  updated_at: string
}

const database = createDatabase('translations.sqlite')
await configureDatabase(database)

await database.batch(
  [
    `CREATE TABLE IF NOT EXISTS translation_bindings (
      guild_id TEXT NOT NULL,
      channel_id TEXT PRIMARY KEY,
      language_a TEXT NOT NULL,
      language_b TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (language_a <> language_b)
    )`,
    `CREATE INDEX IF NOT EXISTS translation_bindings_guild
      ON translation_bindings (guild_id)`,
    `CREATE TABLE IF NOT EXISTS translation_channel_links (
      guild_id TEXT NOT NULL,
      channel_a_id TEXT PRIMARY KEY,
      language_a TEXT NOT NULL,
      channel_b_id TEXT NOT NULL UNIQUE,
      language_b TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (channel_a_id <> channel_b_id),
      CHECK (language_a <> language_b)
    )`,
    `CREATE INDEX IF NOT EXISTS translation_channel_links_guild
      ON translation_channel_links (guild_id)`,
    `CREATE TABLE IF NOT EXISTS translation_group_channels (
      guild_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      channel_id TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (category_id, language)
    )`,
    `CREATE INDEX IF NOT EXISTS translation_group_channels_category
      ON translation_group_channels (category_id)`,
    `CREATE INDEX IF NOT EXISTS translation_group_channels_guild
      ON translation_group_channels (guild_id)`,
    `CREATE TABLE IF NOT EXISTS translation_user_preferences (
      user_id TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (language IN ('zt', 'en', 'ja', 'ko'))
    )`,
  ],
  'write',
)

function firstRow<T>(rows: ReadonlyArray<unknown>): T | undefined {
  return rows[0] as T | undefined
}

function toBinding(row: BindingRow): TranslationBinding {
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    languageA: row.language_a,
    languageB: row.language_b,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toChannelLink(row: ChannelLinkRow): TranslationChannelLink {
  return {
    guildId: row.guild_id,
    channelAId: row.channel_a_id,
    languageA: row.language_a,
    channelBId: row.channel_b_id,
    languageB: row.language_b,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toGroupMember(row: GroupMemberRow): TranslationGroupMember {
  return {
    guildId: row.guild_id,
    categoryId: row.category_id,
    channelId: row.channel_id,
    language: row.language,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toPreference(row: PreferenceRow): TranslationPreference {
  return {
    userId: row.user_id,
    language: row.language,
    updatedAt: row.updated_at,
  }
}

export const translationBindingStore = {
  async get(channelId: string): Promise<TranslationBinding | null> {
    const result = await database.execute({
      sql: `SELECT guild_id, channel_id, language_a, language_b,
        created_by, created_at, updated_at
        FROM translation_bindings WHERE channel_id = ?`,
      args: [channelId],
    })
    const row = firstRow<BindingRow>(result.rows)
    return row ? toBinding(row) : null
  },

  async set(
    guildId: string,
    channelId: string,
    languageA: TranslationLanguage,
    languageB: TranslationLanguage,
    createdBy: string,
  ): Promise<TranslationBinding> {
    const existing = await this.get(channelId)
    const now = new Date().toISOString()
    const binding: TranslationBinding = {
      guildId,
      channelId,
      languageA,
      languageB,
      createdBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await database.execute({
      sql: `INSERT INTO translation_bindings (
        guild_id, channel_id, language_a, language_b,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        guild_id = excluded.guild_id,
        language_a = excluded.language_a,
        language_b = excluded.language_b,
        created_by = excluded.created_by,
        updated_at = excluded.updated_at`,
      args: [
        binding.guildId,
        binding.channelId,
        binding.languageA,
        binding.languageB,
        binding.createdBy,
        binding.createdAt,
        binding.updatedAt,
      ],
    })
    return binding
  },

  async remove(guildId: string, channelId: string): Promise<boolean> {
    const result = await database.execute({
      sql: `DELETE FROM translation_bindings
        WHERE guild_id = ? AND channel_id = ?`,
      args: [guildId, channelId],
    })
    return result.rowsAffected > 0
  },
}

export const translationChannelLinkStore = {
  async get(channelId: string): Promise<TranslationChannelLink | null> {
    const result = await database.execute({
      sql: `SELECT guild_id, channel_a_id, language_a, channel_b_id,
        language_b, created_by, created_at, updated_at
        FROM translation_channel_links
        WHERE channel_a_id = ? OR channel_b_id = ? LIMIT 1`,
      args: [channelId, channelId],
    })
    const row = firstRow<ChannelLinkRow>(result.rows)
    return row ? toChannelLink(row) : null
  },

  async set(
    guildId: string,
    channelAId: string,
    languageA: TranslationLanguage,
    channelBId: string,
    languageB: TranslationLanguage,
    createdBy: string,
  ): Promise<TranslationChannelLink> {
    const existing =
      (await this.get(channelAId)) ?? (await this.get(channelBId))
    const now = new Date().toISOString()
    const link: TranslationChannelLink = {
      guildId,
      channelAId,
      languageA,
      channelBId,
      languageB,
      createdBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    await database.batch(
      [
        {
          sql: `DELETE FROM translation_channel_links
            WHERE channel_a_id IN (?, ?) OR channel_b_id IN (?, ?)`,
          args: [channelAId, channelBId, channelAId, channelBId],
        },
        {
          sql: `INSERT INTO translation_channel_links (
            guild_id, channel_a_id, language_a, channel_b_id, language_b,
            created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            link.guildId,
            link.channelAId,
            link.languageA,
            link.channelBId,
            link.languageB,
            link.createdBy,
            link.createdAt,
            link.updatedAt,
          ],
        },
      ],
      'write',
    )
    return link
  },

  async remove(guildId: string, channelId: string): Promise<boolean> {
    const result = await database.execute({
      sql: `DELETE FROM translation_channel_links
        WHERE guild_id = ? AND (channel_a_id = ? OR channel_b_id = ?)`,
      args: [guildId, channelId, channelId],
    })
    return result.rowsAffected > 0
  },
}

export const translationGroupStore = {
  async getMember(channelId: string): Promise<TranslationGroupMember | null> {
    const result = await database.execute({
      sql: `SELECT guild_id, category_id, channel_id, language,
        created_by, created_at, updated_at
        FROM translation_group_channels WHERE channel_id = ?`,
      args: [channelId],
    })
    const row = firstRow<GroupMemberRow>(result.rows)
    return row ? toGroupMember(row) : null
  },

  async list(categoryId: string): Promise<TranslationGroupMember[]> {
    const result = await database.execute({
      sql: `SELECT guild_id, category_id, channel_id, language,
        created_by, created_at, updated_at
        FROM translation_group_channels
        WHERE category_id = ? ORDER BY language, channel_id`,
      args: [categoryId],
    })
    return (result.rows as unknown as GroupMemberRow[]).map(toGroupMember)
  },

  async replace(
    guildId: string,
    categoryId: string,
    members: ReadonlyArray<{
      channelId: string
      language: TranslationLanguage
    }>,
    createdBy: string,
  ): Promise<TranslationGroupMember[]> {
    const now = new Date().toISOString()
    const records = members.map((member) => ({
      guildId,
      categoryId,
      channelId: member.channelId,
      language: member.language,
      createdBy,
      createdAt: now,
      updatedAt: now,
    }))
    await database.batch(
      [
        {
          sql: `DELETE FROM translation_group_channels
            WHERE guild_id = ? AND category_id = ?`,
          args: [guildId, categoryId],
        },
        ...records.flatMap((record) => [
          {
            sql: `DELETE FROM translation_group_channels
              WHERE channel_id = ?`,
            args: [record.channelId],
          },
          {
            sql: `INSERT INTO translation_group_channels (
              guild_id, category_id, channel_id, language,
              created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [
              record.guildId,
              record.categoryId,
              record.channelId,
              record.language,
              record.createdBy,
              record.createdAt,
              record.updatedAt,
            ],
          },
        ]),
      ],
      'write',
    )
    return records
  },

  async remove(guildId: string, categoryId: string): Promise<boolean> {
    const result = await database.execute({
      sql: `DELETE FROM translation_group_channels
        WHERE guild_id = ? AND category_id = ?`,
      args: [guildId, categoryId],
    })
    return result.rowsAffected > 0
  },
}

export const translationPreferenceStore = {
  async get(userId: string): Promise<TranslationPreference | null> {
    const result = await database.execute({
      sql: `SELECT user_id, language, updated_at
        FROM translation_user_preferences WHERE user_id = ?`,
      args: [userId],
    })
    const row = firstRow<PreferenceRow>(result.rows)
    return row ? toPreference(row) : null
  },

  async set(
    userId: string,
    language: TranslationLanguage,
  ): Promise<TranslationPreference> {
    const preference: TranslationPreference = {
      userId,
      language,
      updatedAt: new Date().toISOString(),
    }
    await database.execute({
      sql: `INSERT INTO translation_user_preferences
        (user_id, language, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          language = excluded.language,
          updated_at = excluded.updated_at`,
      args: [preference.userId, preference.language, preference.updatedAt],
    })
    return preference
  },

  async remove(userId: string): Promise<boolean> {
    const result = await database.execute({
      sql: 'DELETE FROM translation_user_preferences WHERE user_id = ?',
      args: [userId],
    })
    return result.rowsAffected > 0
  },
}
