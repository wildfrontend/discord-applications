import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { buildInviteUrl } from '@dc/core'

const environmentFile = resolve(process.env.BOT_ENV_FILE || '.env')

const environmentKeys = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'DATABASE_DRIVER',
  'DATABASE_URL',
  'DATABASE_AUTH_TOKEN',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_BASE_URL',
  'AI_PROVIDER_NAME',
  'AI_MIN_REQUEST_INTERVAL_MS',
  'TRANSLATION_AUTO_ENABLED',
] as const

type EnvironmentKey = (typeof environmentKeys)[number]

class PromptOutput extends Writable {
  muted = false

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) process.stdout.write(chunk, encoding)
    callback()
  }
}

const promptOutput = new PromptOutput()
const prompts = createInterface({
  input: process.stdin,
  output: promptOutput,
  terminal: Boolean(process.stdin.isTTY),
})

function question(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const handleClose = () => reject(new Error('輸入已中斷。'))
    prompts.once('close', handleClose)
    prompts.question(label, (answer) => {
      prompts.off('close', handleClose)
      resolve(answer)
    })
  })
}

async function ask(
  label: string,
  defaultValue = '',
  options: { allowClear?: boolean } = {},
): Promise<string> {
  const hint = defaultValue ? ` [${defaultValue}]` : ''
  const clearHint =
    options.allowClear && defaultValue ? '（輸入 - 可清除）' : ''
  const answer = (await question(`${label}${hint}${clearHint}: `)).trim()
  if (answer === '-' && options.allowClear) return ''
  return answer || defaultValue
}

async function askSecret(
  label: string,
  currentValue = '',
  options: { allowClear?: boolean } = {},
): Promise<string> {
  const status = currentValue ? ' [已設定，留白保留]' : ''
  const clearHint =
    options.allowClear && currentValue ? '（輸入 - 可清除）' : ''
  process.stdout.write(`${label}${status}${clearHint}: `)
  promptOutput.muted = Boolean(process.stdin.isTTY)
  const answer = (await question('')).trim()
  promptOutput.muted = false
  if (process.stdin.isTTY) process.stdout.write('\n')
  if (answer === '-' && options.allowClear) return ''
  return answer || currentValue
}

async function askBoolean(
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N'
  while (true) {
    const answer = (await question(`${label} [${hint}]: `)).trim().toLowerCase()
    if (!answer) return defaultValue
    if (['y', 'yes'].includes(answer)) return true
    if (['n', 'no'].includes(answer)) return false
    console.log('請輸入 y 或 n。')
  }
}

async function askValidated(
  label: string,
  defaultValue: string,
  validate: (value: string) => string | null,
  options: { allowClear?: boolean } = {},
): Promise<string> {
  while (true) {
    const value = await ask(label, defaultValue, options)
    const error = validate(value)
    if (!error) return value
    console.log(error)
  }
}

function parseEnvironmentFile(): Map<string, string> {
  const values = new Map<string, string>()
  if (!existsSync(environmentFile)) return values
  for (const line of readFileSync(environmentFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    )
    if (!match) continue
    const [, key, rawValue] = match
    let value = rawValue.trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values.set(key, value)
  }
  return values
}

function writeEnvironmentFile(
  updates: Record<EnvironmentKey, string | null>,
): void {
  mkdirSync(dirname(environmentFile), { recursive: true })
  const existing = existsSync(environmentFile)
    ? readFileSync(environmentFile, 'utf8')
    : ''
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const updateValues = new Map<string, string | null>(Object.entries(updates))
  const written = new Set<string>()
  const lines = existing.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^[\s]*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    const key = match?.[1]
    if (!key || !updateValues.has(key)) return [line]
    if (written.has(key)) return []
    written.add(key)
    const value = updateValues.get(key)
    return value === null ? [] : [`${key}=${value}`]
  })

  while (lines.at(-1) === '') lines.pop()
  for (const [key, value] of updateValues) {
    if (!written.has(key) && value !== null) lines.push(`${key}=${value}`)
  }

  const temporaryFile = `${environmentFile}.${process.pid}.tmp`
  writeFileSync(temporaryFile, `${lines.join(eol)}${eol}`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(temporaryFile, environmentFile)
}

function discordIdError(value: string, required: boolean): string | null {
  if (!value && !required) return null
  return /^\d{17,20}$/.test(value)
    ? null
    : 'Discord ID 必須是 17 到 20 位數字。'
}

function urlError(
  value: string,
  required: boolean,
  protocols: readonly string[],
): string | null {
  if (!value && !required) return null
  try {
    const url = new URL(value)
    return protocols.includes(url.protocol) ? null : '網址協定不受支援。'
  } catch {
    return '網址格式錯誤。'
  }
}

async function verifyDiscordCredentials(
  clientId: string,
  token: string,
): Promise<void> {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`Discord 驗證失敗（HTTP ${response.status}）。`)
  }
  const bot = (await response.json()) as {
    id?: unknown
    username?: unknown
    discriminator?: unknown
  }
  if (bot.id !== clientId) {
    throw new Error('Discord Token 與 Application ID 不屬於同一個 Bot。')
  }
  const name =
    typeof bot.username === 'string'
      ? `${bot.username}${bot.discriminator && bot.discriminator !== '0' ? `#${bot.discriminator}` : ''}`
      : clientId
  console.log(`Discord 驗證成功：${name}`)
}

async function main(): Promise<void> {
  const current = parseEnvironmentFile()
  console.log('\nDino Mutant Collections — 自架設定精靈')
  console.log(`設定檔：${environmentFile}\n`)

  const clientId = await askValidated(
    'Discord Application ID',
    current.get('DISCORD_CLIENT_ID') ?? '',
    (value) => discordIdError(value, true),
  )
  let token = await askSecret(
    'Discord Bot Token',
    current.get('DISCORD_TOKEN') ?? '',
  )
  while (!token) {
    console.log('Discord Bot Token 不可空白。')
    token = await askSecret('Discord Bot Token')
  }
  const guildId = await askValidated(
    '開發用 Guild ID（正式全域部署可留白）',
    current.get('DISCORD_GUILD_ID') ?? '',
    (value) => discordIdError(value, false),
    { allowClear: true },
  )

  const automaticTranslation = await askBoolean(
    '啟用頻道自動翻譯',
    current.get('TRANSLATION_AUTO_ENABLED') === 'true',
  )
  let aiApiKey = await askSecret(
    'AI API Key（右鍵與自動翻譯需要）',
    current.get('AI_API_KEY') ?? '',
    { allowClear: true },
  )
  while (automaticTranslation && !aiApiKey) {
    console.log('啟用自動翻譯時必須設定 AI API Key。')
    aiApiKey = await askSecret('AI API Key')
  }
  const aiModel = await ask(
    'AI 模型',
    current.get('AI_MODEL') || 'qwen/qwen3.8-27b',
  )
  const aiBaseUrl = await askValidated(
    'OpenAI 相容 API Base URL',
    current.get('AI_BASE_URL') || 'https://api.groq.com/openai/v1',
    (value) => urlError(value, true, ['http:', 'https:']),
  )
  const aiProviderName = await ask(
    'AI 服務名稱',
    current.get('AI_PROVIDER_NAME') || 'groq',
  )
  const aiInterval = await askValidated(
    'AI 最小請求間隔（毫秒）',
    current.get('AI_MIN_REQUEST_INTERVAL_MS') || '2100',
    (value) => {
      const interval = Number(value)
      return Number.isInteger(interval) && interval >= 0 && interval <= 600_000
        ? null
        : '請輸入 0 到 600000 的整數。'
    },
  )

  const databaseDriver = await askValidated(
    '資料庫模式（sqlite/libsql）',
    current.get('DATABASE_DRIVER') || 'sqlite',
    (value) =>
      ['sqlite', 'libsql'].includes(value.toLowerCase())
        ? null
        : '請輸入 sqlite 或 libsql。',
  )
  let databaseUrl = ''
  let databaseAuthToken = ''
  if (databaseDriver.toLowerCase() === 'libsql') {
    databaseUrl = await askValidated(
      'libSQL Database URL',
      current.get('DATABASE_URL') ?? '',
      (value) =>
        urlError(value, true, [
          'libsql:',
          'http:',
          'https:',
          'ws:',
          'wss:',
          'file:',
        ]),
    )
    databaseAuthToken = await askSecret(
      'libSQL Auth Token',
      current.get('DATABASE_AUTH_TOKEN') ?? '',
    )
  }

  if (await askBoolean('現在驗證 Discord Token', true)) {
    await verifyDiscordCredentials(clientId, token)
  }

  writeEnvironmentFile({
    DISCORD_TOKEN: token,
    DISCORD_CLIENT_ID: clientId,
    DISCORD_GUILD_ID: guildId || null,
    DATABASE_DRIVER: databaseDriver.toLowerCase(),
    DATABASE_URL: databaseUrl || null,
    DATABASE_AUTH_TOKEN: databaseAuthToken || null,
    AI_API_KEY: aiApiKey || null,
    AI_MODEL: aiModel,
    AI_BASE_URL: aiBaseUrl.replace(/\/$/, ''),
    AI_PROVIDER_NAME: aiProviderName,
    AI_MIN_REQUEST_INTERVAL_MS: aiInterval,
    TRANSLATION_AUTO_ENABLED: String(automaticTranslation),
  })

  console.log(`\n設定已安全寫入：${environmentFile}`)
  console.log(`邀請 Bot：${buildInviteUrl(clientId)}`)
  console.log('\n啟動或套用新設定：docker compose up -d --force-recreate bot')
  console.log('查看 Log：docker compose logs -f bot\n')
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n設定失敗：${message}`)
  process.exitCode = 1
} finally {
  prompts.close()
}
