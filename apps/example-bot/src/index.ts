import { requireEnv, startBot } from '@dc/core'
import { acquireBotProcessLock } from './process-lock.js'

acquireBotProcessLock()

const [{ commands }, { startRecurringEventScheduler }] = await Promise.all([
  import('./commands/index.js'),
  import('./recurring-events/scheduler.js'),
])

const client = await startBot({
  token: requireEnv('DISCORD_TOKEN'),
  commands,
})

startRecurringEventScheduler(client)
