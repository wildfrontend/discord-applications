import { requireEnv, startBot } from '@dc/core'
import { commands } from './commands/index.js'

await startBot({
  token: requireEnv('DISCORD_TOKEN'),
  commands,
})
