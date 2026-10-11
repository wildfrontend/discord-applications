import { randomUUID } from 'node:crypto'
import { createDatabase, databaseDriver } from '../database.js'

const LEASE_KEY = 'discord-gateway-and-scheduler'
const LEASE_DURATION_MS = 45_000
const RENEW_INTERVAL_MS = 15_000
const RETRY_INTERVAL_MS = 2_000

export async function acquireRuntimeLease(): Promise<() => Promise<void>> {
  if (databaseDriver === 'sqlite') return async () => undefined

  const database = createDatabase('runtime.sqlite')
  await database.execute(`CREATE TABLE IF NOT EXISTS bot_runtime_leases (
    lease_key TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`)

  const ownerId = randomUUID()
  while (!(await tryAcquire(database, ownerId))) {
    console.log('[bot] Another cloud instance is active; waiting for lease')
    await delay(RETRY_INTERVAL_MS)
  }

  console.log('[bot] Acquired cloud runtime lease')
  let released = false
  let lastRenewedAt = Date.now()
  let renewing = false
  const timer = setInterval(async () => {
    if (released || renewing) return
    renewing = true
    try {
      const result = await database.execute({
        sql: `UPDATE bot_runtime_leases SET expires_at = ?
          WHERE lease_key = ? AND owner_id = ?`,
        args: [Date.now() + LEASE_DURATION_MS, LEASE_KEY, ownerId],
      })
      if (result.rowsAffected === 0) throw new Error('lease ownership was lost')
      lastRenewedAt = Date.now()
    } catch (error) {
      console.error('[bot] Failed to renew cloud runtime lease:', error)
      if (Date.now() - lastRenewedAt >= LEASE_DURATION_MS) {
        console.error('[bot] Runtime lease expired; stopping this instance')
        process.kill(process.pid, 'SIGTERM')
      }
    } finally {
      renewing = false
    }
  }, RENEW_INTERVAL_MS)
  timer.unref()

  return async () => {
    if (released) return
    released = true
    clearInterval(timer)
    try {
      await database.execute({
        sql: `DELETE FROM bot_runtime_leases
          WHERE lease_key = ? AND owner_id = ?`,
        args: [LEASE_KEY, ownerId],
      })
    } catch (error) {
      console.error('[bot] Failed to release cloud runtime lease:', error)
    }
  }
}

async function tryAcquire(
  database: ReturnType<typeof createDatabase>,
  ownerId: string,
): Promise<boolean> {
  const now = Date.now()
  const result = await database.execute({
    sql: `INSERT INTO bot_runtime_leases (lease_key, owner_id, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(lease_key) DO UPDATE SET
        owner_id = excluded.owner_id,
        expires_at = excluded.expires_at
      WHERE bot_runtime_leases.expires_at < ?
        OR bot_runtime_leases.owner_id = ?`,
    args: [LEASE_KEY, ownerId, now + LEASE_DURATION_MS, now, ownerId],
  })
  return result.rowsAffected > 0
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
