import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from 'discord.js'

export interface SlashCommand {
  kind: 'chat-input'
  /** 透過 SlashCommandBuilder#toJSON() 產生的指令定義 */
  data: RESTPostAPIChatInputApplicationCommandsJSONBody
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>
}

export interface MessageCommand {
  kind: 'message'
  /** 透過 ContextMenuCommandBuilder#toJSON() 產生的指令定義 */
  data: RESTPostAPIContextMenuApplicationCommandsJSONBody
  execute: (interaction: MessageContextMenuCommandInteraction) => Promise<void>
}

export type BotCommand = SlashCommand | MessageCommand

export function defineCommand(
  command: Omit<SlashCommand, 'kind'>,
): SlashCommand {
  return { ...command, kind: 'chat-input' }
}

export function defineMessageCommand(
  command: Omit<MessageCommand, 'kind'>,
): MessageCommand {
  return { ...command, kind: 'message' }
}
