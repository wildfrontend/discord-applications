import { type Client, createClient } from '@libsql/client'
import { dataFile } from './recurring-events/storage.js'

export type DatabaseDriver = 'sqlite' | 'libsql'

const configuredDriver = process.env.DATABASE_DRIVER?.trim().toLowerCase()

if (
  configuredDriver !== undefined &&
  configuredDriver !== 'sqlite' &&
  configuredDriver !== 'libsql'
) {
  throw new Error('DATABASE_DRIVER 必須是 sqlite 或 libsql。')
}

export const databaseDriver: DatabaseDriver =
  configuredDriver === 'libsql' ||
  (!configuredDriver && process.env.DATABASE_URL?.trim())
    ? 'libsql'
    : 'sqlite'

const clients = new Set<Client>()

function remoteDatabaseConfig() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error('DATABASE_DRIVER=libsql 時必須設定 DATABASE_URL。')
  }
  return {
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined,
  }
}

export function createDatabase(localFileName: string): Client {
  const client = createClient(
    databaseDriver === 'libsql'
      ? remoteDatabaseConfig()
      : {
          url: `file:${dataFile(localFileName)}`,
          timeout: 5_000,
        },
  )
  clients.add(client)
  return client
}

export async function configureDatabase(client: Client): Promise<void> {
  if (databaseDriver !== 'sqlite') return
  await client.execute('PRAGMA journal_mode = WAL')
  await client.execute('PRAGMA busy_timeout = 5000')
}

export function closeDatabases(): void {
  for (const client of clients) client.close()
  clients.clear()
}

export function databaseDescription(): string {
  if (databaseDriver === 'sqlite') return 'sqlite/local-volume'
  try {
    const url = process.env.DATABASE_URL
    return url ? `libsql/${new URL(url).hostname}` : 'libsql/remote'
  } catch {
    return 'libsql/remote'
  }
}
