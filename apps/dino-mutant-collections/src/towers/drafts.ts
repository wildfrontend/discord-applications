import { randomUUID } from 'node:crypto'
import { configureDatabase, createDatabase } from '../database.js'
import type { TowerObservation } from './service.js'
import type { TowerBinding } from './store.js'

export interface DraftNotice {
  key: 'unreadable' | 'failed' | 'unsupported' | 'wrongServer'
  count: number
}

export interface TowerDraft {
  id: string
  bindingId: string
  guildId: string
  channelId: string
  userId: string
  revision: number
  createdAt: number
  updatedAt: number
  observations: TowerObservation[]
  notices: DraftNotice[]
}

const database = createDatabase('tower-drafts.sqlite')
await configureDatabase(database)
await database.execute(`CREATE TABLE IF NOT EXISTS tower_private_drafts (
  id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL, user_id TEXT NOT NULL, revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  observations_json TEXT NOT NULL, notices_json TEXT NOT NULL,
  UNIQUE (binding_id, user_id)
)`)

export function mergeTowerObservations(
  base: readonly TowerObservation[],
  incoming: readonly TowerObservation[],
): TowerObservation[] {
  const merged = new Map(base.map((item) => [item.area, item]))
  for (const item of incoming) {
    const prior = merged.get(item.area)
    if (
      !prior ||
      Math.floor(item.observedAt / 60_000) >
        Math.floor(prior.observedAt / 60_000) ||
      (Math.floor(item.observedAt / 60_000) ===
        Math.floor(prior.observedAt / 60_000) &&
        (item.uploadedAt > prior.uploadedAt ||
          (item.uploadedAt === prior.uploadedAt &&
            item.sourceAttachmentId > prior.sourceAttachmentId)))
    )
      merged.set(item.area, item)
  }
  return [...merged.values()].sort((a, b) => a.area - b.area)
}

function decode(value: Record<string, unknown> | undefined): TowerDraft | null {
  if (!value) return null
  return {
    id: String(value.id),
    bindingId: String(value.binding_id),
    guildId: String(value.guild_id),
    channelId: String(value.channel_id),
    userId: String(value.user_id),
    revision: Number(value.revision),
    createdAt: Number(value.created_at),
    updatedAt: Number(value.updated_at),
    observations: JSON.parse(String(value.observations_json)),
    notices: JSON.parse(String(value.notices_json)),
  }
}

export const towerDraftStore = {
  async getForUser(
    binding: TowerBinding,
    userId: string,
  ): Promise<TowerDraft | null> {
    const result = await database.execute({
      sql: 'SELECT * FROM tower_private_drafts WHERE binding_id = ? AND user_id = ?',
      args: [binding.id, userId],
    })
    return decode(result.rows[0])
  },
  async get(id: string): Promise<TowerDraft | null> {
    const result = await database.execute({
      sql: 'SELECT * FROM tower_private_drafts WHERE id = ?',
      args: [id],
    })
    return decode(result.rows[0])
  },
  async stage(
    binding: TowerBinding,
    userId: string,
    uploadedAt: number,
    observations: TowerObservation[],
    notices: DraftNotice[],
  ): Promise<TowerDraft> {
    const prior = await this.getForUser(binding, userId)
    const draft: TowerDraft = {
      id: prior?.id ?? randomUUID(),
      bindingId: binding.id,
      guildId: binding.guildId,
      channelId: binding.channelId,
      userId,
      revision: (prior?.revision ?? 0) + 1,
      createdAt: prior?.createdAt ?? uploadedAt,
      updatedAt: Math.max(prior?.updatedAt ?? uploadedAt, uploadedAt),
      observations: mergeTowerObservations(
        prior?.observations ?? [],
        observations,
      ),
      notices,
    }
    await database.execute({
      sql: `INSERT INTO tower_private_drafts (id, binding_id, guild_id, channel_id, user_id, revision, created_at, updated_at, observations_json, notices_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(binding_id, user_id) DO UPDATE SET
        revision = excluded.revision, updated_at = excluded.updated_at, observations_json = excluded.observations_json, notices_json = excluded.notices_json`,
      args: [
        draft.id,
        draft.bindingId,
        draft.guildId,
        draft.channelId,
        userId,
        draft.revision,
        draft.createdAt,
        draft.updatedAt,
        JSON.stringify(draft.observations),
        JSON.stringify(notices),
      ],
    })
    return draft
  },
  async remove(id: string, revision: number): Promise<void> {
    await database.execute({
      sql: 'DELETE FROM tower_private_drafts WHERE id = ? AND revision = ?',
      args: [id, revision],
    })
  },
}
