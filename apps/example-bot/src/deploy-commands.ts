import { deployCommands, requireEnv } from '@dc/core'
import { commands } from './commands/index.js'

await deployCommands({
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('DISCORD_CLIENT_ID'),
  guildId: process.env.DISCORD_GUILD_ID || undefined,
  commands,
})
