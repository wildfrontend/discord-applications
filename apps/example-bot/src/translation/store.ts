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

interface BindingRow {
  guild_id: string
  channel_id: string
  language_a: TranslationLanguage
  language_b: TranslationLanguage
  created_by: string
  created_at: string
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
