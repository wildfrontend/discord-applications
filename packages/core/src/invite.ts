import {
  OAuth2Scopes,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js'

/** 一般 slash command bot 需要的基本權限 */
export const DEFAULT_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.CreateEvents,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.ManageWebhooks,
]

/**
 * 產生把 bot 加入伺服器的 OAuth2 邀請連結。
 */
export function buildInviteUrl(
  clientId: string,
  permissions: bigint[] = DEFAULT_BOT_PERMISSIONS,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '),
    permissions: new PermissionsBitField(permissions).bitfield.toString(),
  })
  return `https://discord.com/oauth2/authorize?${params}`
}
