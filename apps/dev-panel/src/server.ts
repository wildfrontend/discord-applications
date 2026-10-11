import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { hostname, tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDirectory = join(appDirectory, 'public')
const defaultDataDirectory = resolve(
  appDirectory,
  '../dino-mutant-collections/data',
)
const dataDirectory = resolve(process.env.BOT_DATA_DIR || defaultDataDirectory)
const port = Number(process.env.DEV_PANEL_PORT || 4310)
const host = '127.0.0.1'
const startedAt = new Date().toISOString()

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('DEV_PANEL_PORT 必須是 1 到 65535 之間的整數。')
}

const recurringDatabaseFile = join(dataDirectory, 'recurring-events.sqlite')
const translationDatabaseFile = join(dataDirectory, 'translations.sqlite')

interface SqliteRow {
  [key: string]: unknown
}

interface MutationBody {
  confirm?: string
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(payload))
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      )
      .get(table),
  )
}

function databaseSize(file: string): number | null {
  try {
    return statSync(file).size
  } catch {
    return null
  }
}

function readRows(file: string, table: string, sql: string): SqliteRow[] {
  if (!existsSync(file)) return []
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    database.exec('PRAGMA busy_timeout = 5000')
    if (!tableExists(database, table)) return []
    return database.prepare(sql).all() as unknown as SqliteRow[]
  } finally {
    database.close()
  }
}

function parseTemplateName(value: unknown): string {
  if (typeof value !== 'string') return '未命名活動'
  try {
    const template = JSON.parse(value) as { name?: unknown }
    return typeof template.name === 'string' ? template.name : '未命名活動'
  } catch {
    return '無法解析的活動'
  }
}

function botProcessStatus() {
  const lockPrefix = 'dc-dino-mutant-collections-'
  const locks = readdirSync(tmpdir())
    .filter((name) => name.startsWith(lockPrefix) && name.endsWith('.lock'))
    .flatMap((name) => {
      try {
        const owner = JSON.parse(
          readFileSync(join(tmpdir(), name), 'utf8'),
        ) as {
          pid?: unknown
          hostname?: unknown
          startedAt?: unknown
        }
        if (
          typeof owner.pid !== 'number' ||
          typeof owner.hostname !== 'string' ||
          typeof owner.startedAt !== 'string'
        ) {
          return []
        }
        let running = false
        if (owner.hostname === hostname()) {
          try {
            process.kill(owner.pid, 0)
            running = true
          } catch {
            running = false
          }
        }
        return [
          {
            applicationId: name.slice(lockPrefix.length, -'.lock'.length),
            pid: owner.pid,
            hostname: owner.hostname,
            startedAt: owner.startedAt,
            running,
          },
        ]
      } catch {
        return []
      }
    })
  return locks.find((lock) => lock.running) ?? locks[0] ?? null
}

function dashboardData() {
  const schedules = readRows(
    recurringDatabaseFile,
    'recurring_events',
    `SELECT id, guild_id, source_event_id, latest_event_id, created_by,
            created_at, interval_value, unit, next_start_at, template_json
       FROM recurring_events
      ORDER BY next_start_at`,
  ).map((row) => ({
    id: row.id,
    guildId: row.guild_id,
    sourceEventId: row.source_event_id,
    latestEventId: row.latest_event_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    interval: row.interval_value,
    unit: row.unit,
    nextStartAt: row.next_start_at,
    name: parseTemplateName(row.template_json),
  }))
  const eventNotifications = readRows(
    recurringDatabaseFile,
    'event_notification_settings',
    `SELECT guild_id, channel_id, updated_by, updated_at
       FROM event_notification_settings
      ORDER BY guild_id`,
  ).map((row) => ({
    guildId: row.guild_id,
    channelId: row.channel_id,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }))

  const groupMembers = readRows(
    translationDatabaseFile,
    'translation_group_channels',
    `SELECT guild_id, category_id, channel_id, language, created_by,
            created_at, updated_at
       FROM translation_group_channels
      ORDER BY category_id, language`,
  )
  const groupsByCategory = new Map<
    string,
    {
      categoryId: string
      guildId: unknown
      createdBy: unknown
      updatedAt: unknown
      members: Array<{ channelId: unknown; language: unknown }>
    }
  >()
  for (const member of groupMembers) {
    if (typeof member.category_id !== 'string') continue
    const group = groupsByCategory.get(member.category_id) ?? {
      categoryId: member.category_id,
      guildId: member.guild_id,
      createdBy: member.created_by,
      updatedAt: member.updated_at,
      members: [],
    }
    group.members.push({
      channelId: member.channel_id,
      language: member.language,
    })
    groupsByCategory.set(member.category_id, group)
  }

  const preferences = readRows(
    translationDatabaseFile,
    'translation_user_preferences',
    `SELECT user_id, language, updated_at
       FROM translation_user_preferences
      ORDER BY updated_at DESC`,
  ).map((row) => ({
    userId: row.user_id,
    language: row.language,
    updatedAt: row.updated_at,
  }))
  const channelLinks = readRows(
    translationDatabaseFile,
    'translation_channel_links',
    'SELECT channel_a_id, channel_b_id FROM translation_channel_links',
  )
  const legacyBindings = readRows(
    translationDatabaseFile,
    'translation_bindings',
    'SELECT channel_id FROM translation_bindings',
  )

  return {
    panel: { startedAt, now: new Date().toISOString(), dataDirectory },
    bot: botProcessStatus(),
    databases: {
      recurringEvents: {
        exists: existsSync(recurringDatabaseFile),
        size: databaseSize(recurringDatabaseFile),
      },
      translations: {
        exists: existsSync(translationDatabaseFile),
        size: databaseSize(translationDatabaseFile),
      },
    },
    schedules,
    eventNotifications,
    translation: {
      groups: [...groupsByCategory.values()],
      preferences,
      channelLinkCount: channelLinks.length,
      legacyBindingCount: legacyBindings.length,
    },
  }
}

async function readBody(request: IncomingMessage): Promise<MutationBody> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 8_192) throw new Error('Request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as MutationBody
}

function mutationIsAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const allowedOrigins = new Set([
    `http://${host}:${port}`,
    `http://localhost:${port}`,
  ])
  return (
    typeof origin === 'string' &&
    allowedOrigins.has(origin) &&
    request.headers['x-dev-panel-action'] === '1'
  )
}

function runDelete(
  file: string,
  table: string,
  sql: string,
  parameters: readonly (string | number)[] = [],
): number {
  if (!existsSync(file)) return 0
  const database = new DatabaseSync(file)
  try {
    database.exec('PRAGMA busy_timeout = 5000')
    if (!tableExists(database, table)) return 0
    const result = database.prepare(sql).run(...parameters)
    return Number(result.changes)
  } finally {
    database.close()
  }
}

function resetTranslations(): number {
  if (!existsSync(translationDatabaseFile)) return 0
  const database = new DatabaseSync(translationDatabaseFile)
  try {
    database.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE')
    let changes = 0
    for (const table of [
      'translation_group_channels',
      'translation_channel_links',
      'translation_bindings',
      'translation_user_preferences',
    ]) {
      if (!tableExists(database, table)) continue
      changes += Number(database.prepare(`DELETE FROM ${table}`).run().changes)
    }
    database.exec('COMMIT')
    return changes
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // The transaction may not have started.
    }
    throw error
  } finally {
    database.close()
  }
}

function contentType(file: string): string {
  const extension = extname(file)
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  return 'text/html; charset=utf-8'
}

function sendStatic(response: ServerResponse, pathname: string): void {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1)
  if (!['index.html', 'app.css', 'app.js'].includes(requested)) {
    sendJson(response, 404, { error: 'Not found' })
    return
  }
  const file = join(publicDirectory, requested)
  if (!existsSync(file)) {
    sendJson(response, 404, { error: 'Asset not found' })
    return
  }
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Content-Type': contentType(file),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })
  createReadStream(file).pipe(response)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`)

  try {
    if (request.method === 'GET' && url.pathname === '/api/dashboard') {
      sendJson(response, 200, dashboardData())
      return
    }

    if (request.method === 'GET') {
      sendStatic(response, url.pathname)
      return
    }

    if (!mutationIsAllowed(request)) {
      sendJson(response, 403, { error: '只允許從本機 Dev Panel 執行操作。' })
      return
    }

    const body = await readBody(request)
    const recurringMatch = url.pathname.match(
      /^\/api\/recurring\/([0-9a-f-]{36})$/,
    )
    if (request.method === 'DELETE' && recurringMatch) {
      const id = recurringMatch[1]
      if (body.confirm !== id) {
        sendJson(response, 400, { error: '確認值不符。' })
        return
      }
      const changes = runDelete(
        recurringDatabaseFile,
        'recurring_events',
        'DELETE FROM recurring_events WHERE id = ?',
        [id],
      )
      sendJson(response, 200, { ok: true, changes })
      return
    }

    const groupMatch = url.pathname.match(
      /^\/api\/translation-groups\/(\d{17,20})$/,
    )
    if (request.method === 'DELETE' && groupMatch) {
      const categoryId = groupMatch[1]
      if (body.confirm !== categoryId) {
        sendJson(response, 400, { error: '確認值不符。' })
        return
      }
      const changes = runDelete(
        translationDatabaseFile,
        'translation_group_channels',
        'DELETE FROM translation_group_channels WHERE category_id = ?',
        [categoryId],
      )
      sendJson(response, 200, { ok: true, changes })
      return
    }

    const preferenceMatch = url.pathname.match(
      /^\/api\/preferences\/(\d{17,20})$/,
    )
    if (request.method === 'DELETE' && preferenceMatch) {
      const userId = preferenceMatch[1]
      if (body.confirm !== userId) {
        sendJson(response, 400, { error: '確認值不符。' })
        return
      }
      const changes = runDelete(
        translationDatabaseFile,
        'translation_user_preferences',
        'DELETE FROM translation_user_preferences WHERE user_id = ?',
        [userId],
      )
      sendJson(response, 200, { ok: true, changes })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/reset/recurring') {
      if (body.confirm !== 'recurring') {
        sendJson(response, 400, { error: '確認值不符。' })
        return
      }
      const changes = runDelete(
        recurringDatabaseFile,
        'recurring_events',
        'DELETE FROM recurring_events',
      )
      sendJson(response, 200, { ok: true, changes })
      return
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/api/reset/preferences'
    ) {
      if (body.confirm !== 'preferences') {
        sendJson(response, 400, { error: '確認值不符。' })
        return
      }
      const changes = runDelete(
        translationDatabaseFile,
        'translation_user_preferences',
        'DELETE FROM translation_user_preferences',
      )
      sendJson(response, 200, { ok: true, changes })
      return
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/api/reset/translations'
    ) {
      if (body.confirm !== 'translations') {
        sendJson(response, 400, { error: '確認值不符。' })
        return
      }
      sendJson(response, 200, { ok: true, changes: resetTranslations() })
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    console.error(`[dev-panel] Request failed: ${details}`)
    sendJson(response, 500, { error: details })
  }
})

server.listen(port, host, () => {
  console.log(`[dev-panel] http://${host}:${port}`)
  console.log(`[dev-panel] Reading data from ${dataDirectory}`)
})
