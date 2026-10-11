import { DatabaseSync } from 'node:sqlite'
import { dataFile } from '../recurring-events/storage.js'
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

const database = new DatabaseSync(dataFile('translations.sqlite'))
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS translation_bindings (
    guild_id TEXT NOT NULL,
    channel_id TEXT PRIMARY KEY,
    language_a TEXT NOT NULL,
    language_b TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (language_a <> language_b)
  );
  CREATE INDEX IF NOT EXISTS translation_bindings_guild
    ON translation_bindings (guild_id);

  CREATE TABLE IF NOT EXISTS translation_channel_links (
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
  );
  CREATE INDEX IF NOT EXISTS translation_channel_links_guild
    ON translation_channel_links (guild_id);

  CREATE TABLE IF NOT EXISTS translation_group_channels (
    guild_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    channel_id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (category_id, language)
  );
  CREATE INDEX IF NOT EXISTS translation_group_channels_category
    ON translation_group_channels (category_id);
  CREATE INDEX IF NOT EXISTS translation_group_channels_guild
    ON translation_group_channels (guild_id);

  CREATE TABLE IF NOT EXISTS translation_user_preferences (
    user_id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (language IN ('zt', 'en', 'ja', 'ko'))
  );
`)

const getStatement = database.prepare(`
  SELECT guild_id, channel_id, language_a, language_b,
         created_by, created_at, updated_at
  FROM translation_bindings
  WHERE channel_id = ?
`)
const upsertStatement = database.prepare(`
  INSERT INTO translation_bindings (
    guild_id, channel_id, language_a, language_b,
    created_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(channel_id) DO UPDATE SET
    guild_id = excluded.guild_id,
    language_a = excluded.language_a,
    language_b = excluded.language_b,
    created_by = excluded.created_by,
    updated_at = excluded.updated_at
`)
const removeStatement = database.prepare(`
  DELETE FROM translation_bindings
  WHERE guild_id = ? AND channel_id = ?
`)
const getChannelLinkStatement = database.prepare(`
  SELECT guild_id, channel_a_id, language_a, channel_b_id, language_b,
         created_by, created_at, updated_at
  FROM translation_channel_links
  WHERE channel_a_id = ? OR channel_b_id = ?
  LIMIT 1
`)
const removeConflictingChannelLinksStatement = database.prepare(`
  DELETE FROM translation_channel_links
  WHERE channel_a_id IN (?, ?) OR channel_b_id IN (?, ?)
`)
const insertChannelLinkStatement = database.prepare(`
  INSERT INTO translation_channel_links (
    guild_id, channel_a_id, language_a, channel_b_id, language_b,
    created_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const removeChannelLinkStatement = database.prepare(`
  DELETE FROM translation_channel_links
  WHERE guild_id = ? AND (channel_a_id = ? OR channel_b_id = ?)
`)
const getGroupMemberStatement = database.prepare(`
  SELECT guild_id, category_id, channel_id, language,
         created_by, created_at, updated_at
  FROM translation_group_channels
  WHERE channel_id = ?
`)
const listGroupMembersStatement = database.prepare(`
  SELECT guild_id, category_id, channel_id, language,
         created_by, created_at, updated_at
  FROM translation_group_channels
  WHERE category_id = ?
  ORDER BY language, channel_id
`)
const removeGroupStatement = database.prepare(`
  DELETE FROM translation_group_channels
  WHERE guild_id = ? AND category_id = ?
`)
const removeGroupMemberByChannelStatement = database.prepare(`
  DELETE FROM translation_group_channels
  WHERE channel_id = ?
`)
const insertGroupMemberStatement = database.prepare(`
  INSERT INTO translation_group_channels (
    guild_id, category_id, channel_id, language,
    created_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`)
const getPreferenceStatement = database.prepare(`
  SELECT user_id, language, updated_at
  FROM translation_user_preferences
  WHERE user_id = ?
`)
const upsertPreferenceStatement = database.prepare(`
  INSERT INTO translation_user_preferences (user_id, language, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    language = excluded.language,
    updated_at = excluded.updated_at
`)
const removePreferenceStatement = database.prepare(`
  DELETE FROM translation_user_preferences
  WHERE user_id = ?
`)

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
    const row = getStatement.get(channelId) as BindingRow | undefined
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
    upsertStatement.run(
      binding.guildId,
      binding.channelId,
      binding.languageA,
      binding.languageB,
      binding.createdBy,
      binding.createdAt,
      binding.updatedAt,
    )
    return binding
  },

  async remove(guildId: string, channelId: string): Promise<boolean> {
    const result = removeStatement.run(guildId, channelId)
    return Number(result.changes) > 0
  },
}

export const translationChannelLinkStore = {
  async get(channelId: string): Promise<TranslationChannelLink | null> {
    const row = getChannelLinkStatement.get(channelId, channelId) as
      | ChannelLinkRow
      | undefined
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

    database.exec('BEGIN IMMEDIATE')
    try {
      removeConflictingChannelLinksStatement.run(
        channelAId,
        channelBId,
        channelAId,
        channelBId,
      )
      insertChannelLinkStatement.run(
        link.guildId,
        link.channelAId,
        link.languageA,
        link.channelBId,
        link.languageB,
        link.createdBy,
        link.createdAt,
        link.updatedAt,
      )
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return link
  },

  async remove(guildId: string, channelId: string): Promise<boolean> {
    const result = removeChannelLinkStatement.run(guildId, channelId, channelId)
    return Number(result.changes) > 0
  },
}

export const translationGroupStore = {
  async getMember(channelId: string): Promise<TranslationGroupMember | null> {
    const row = getGroupMemberStatement.get(channelId) as
      | GroupMemberRow
      | undefined
    return row ? toGroupMember(row) : null
  },

  async list(categoryId: string): Promise<TranslationGroupMember[]> {
    const rows = listGroupMembersStatement.all(
      categoryId,
    ) as unknown as GroupMemberRow[]
    return rows.map(toGroupMember)
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

    database.exec('BEGIN IMMEDIATE')
    try {
      removeGroupStatement.run(guildId, categoryId)
      for (const record of records) {
        // A text channel can belong to only one translation group, even if it
        // was moved between Discord categories after an earlier setup.
        removeGroupMemberByChannelStatement.run(record.channelId)
        insertGroupMemberStatement.run(
          record.guildId,
          record.categoryId,
          record.channelId,
          record.language,
          record.createdBy,
          record.createdAt,
          record.updatedAt,
        )
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return records
  },

  async remove(guildId: string, categoryId: string): Promise<boolean> {
    const result = removeGroupStatement.run(guildId, categoryId)
    return Number(result.changes) > 0
  },
}

export const translationPreferenceStore = {
  async get(userId: string): Promise<TranslationPreference | null> {
    const row = getPreferenceStatement.get(userId) as PreferenceRow | undefined
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
    upsertPreferenceStatement.run(
      preference.userId,
      preference.language,
      preference.updatedAt,
    )
    return preference
  },

  async remove(userId: string): Promise<boolean> {
    const result = removePreferenceStatement.run(userId)
    return Number(result.changes) > 0
  },
}
