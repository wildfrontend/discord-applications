import { buildInviteUrl, requireEnv } from '@dc/core'

console.log(buildInviteUrl(requireEnv('DISCORD_CLIENT_ID')))
