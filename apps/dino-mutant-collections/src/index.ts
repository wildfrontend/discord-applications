import { requireEnv, startBot } from '@dc/core'
import { type Client, GatewayIntentBits } from 'discord.js'
import { closeDatabases, databaseDescription } from './database.js'
import { acquireBotProcessLock } from './process-lock.js'
import { startHealthServer } from './runtime/health-server.js'
import { acquireRuntimeLease } from './runtime/lease.js'

const releaseProcessLock = acquireBotProcessLock()
const healthServer = await startHealthServer()
let client: Client | undefined
let stopScheduler: (() => void) | undefined
let releaseRuntimeLease: (() => Promise<void>) | undefined
let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[bot] Received ${signal}; shutting down`)
  healthServer.setStatus('stopping')
  stopScheduler?.()
  client?.destroy()
  await releaseRuntimeLease?.()
  closeDatabases()
  await healthServer.close()
  releaseProcessLock()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(
      () => process.exit(0),
      (error) => {
        console.error('[bot] Graceful shutdown failed:', error)
        process.exit(1)
      },
    )
  })
}

releaseRuntimeLease = await acquireRuntimeLease()

const [
  { commands },
  { startRecurringEventScheduler },
  { startTranslationFeature },
] = await Promise.all([
  import('./commands/index.js'),
  import('./recurring-events/scheduler.js'),
  import('./translation/feature.js'),
])

const automaticTranslation = process.env.TRANSLATION_AUTO_ENABLED === 'true'
const intents = [GatewayIntentBits.Guilds]
if (automaticTranslation) {
  intents.push(
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  )
}

client = await startBot({
  token: requireEnv('DISCORD_TOKEN'),
  commands,
  intents,
})

stopScheduler = startRecurringEventScheduler(client)
startTranslationFeature(client, { automatic: automaticTranslation })
healthServer.setStatus('ready')
console.log(`[bot] Database: ${databaseDescription()}`)
