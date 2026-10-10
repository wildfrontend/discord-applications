import { requireEnv, startBot } from '@dc/core'
import { GatewayIntentBits } from 'discord.js'
import { acquireBotProcessLock } from './process-lock.js'

acquireBotProcessLock()

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

const client = await startBot({
  token: requireEnv('DISCORD_TOKEN'),
  commands,
  intents,
})

startRecurringEventScheduler(client)
startTranslationFeature(client, { automatic: automaticTranslation })
