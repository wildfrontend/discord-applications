import { requireEnv, startBot } from '@dc/core'
import { commands } from './commands/index.js'
import { startRecurringEventScheduler } from './recurring-events/scheduler.js'

const client = await startBot({
  token: requireEnv('DISCORD_TOKEN'),
  commands,
})

startRecurringEventScheduler(client)
