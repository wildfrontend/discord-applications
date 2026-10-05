import {
  Client,
  type ClientOptions,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from 'discord.js'
import type { SlashCommand } from './command.js'

export interface CreateBotOptions {
  token: string
  commands: SlashCommand[]
  intents?: ClientOptions['intents']
}

/**
 * 建立一個已綁定 slash command 分派邏輯的 Discord client。
 * 回傳的 client 尚未登入，呼叫 `client.login(token)` 或使用 `startBot`。
 */
export function createBot({
  commands,
  intents = [GatewayIntentBits.Guilds],
}: Omit<CreateBotOptions, 'token'>): Client {
  const client = new Client({ intents })
  const commandMap = new Map(commands.map((c) => [c.data.name, c]))

  client.once(Events.ClientReady, (c) => {
    console.log(`[bot] Logged in as ${c.user.tag}`)
  })

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return

    const command = commandMap.get(interaction.commandName)
    if (!command) return

    try {
      await command.execute(interaction)
    } catch (error) {
      console.error(`[bot] Command /${interaction.commandName} failed:`, error)
      const reply = {
        content: '執行指令時發生錯誤。',
        flags: MessageFlags.Ephemeral,
      } as const
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply)
      } else {
        await interaction.reply(reply)
      }
    }
  })

  return client
}

export async function startBot(options: CreateBotOptions): Promise<Client> {
  const client = createBot(options)
  await client.login(options.token)
  return client
}

export interface DeployCommandsOptions {
  token: string
  clientId: string
  commands: SlashCommand[]
  /** 指定時只註冊到該 guild（即時生效，適合開發）；否則註冊為全域指令 */
  guildId?: string
}

export async function deployCommands({
  token,
  clientId,
  commands,
  guildId,
}: DeployCommandsOptions): Promise<void> {
  const rest = new REST().setToken(token)
  const body = commands.map((c) => c.data)
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId)

  await rest.put(route, { body })
  console.log(
    `[deploy] Registered ${body.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}`,
  )
}
