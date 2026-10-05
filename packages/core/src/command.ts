import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js'

export interface SlashCommand {
  /** 透過 SlashCommandBuilder#toJSON() 產生的指令定義 */
  data: RESTPostAPIChatInputApplicationCommandsJSONBody
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>
}

export function defineCommand(command: SlashCommand): SlashCommand {
  return command
}
