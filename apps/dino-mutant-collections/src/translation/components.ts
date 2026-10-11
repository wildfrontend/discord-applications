import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js'
import {
  languageNames,
  supportedLanguages,
  type TranslationLanguage,
} from './languages.js'

export const originalButtonPrefix = 'translate:original:'
export const targetSelectPrefix = 'translate:target:'

export function originalButton(
  channelId: string,
  messageId: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${originalButtonPrefix}${channelId}:${messageId}`)
      .setLabel('查看原文')
      .setStyle(ButtonStyle.Secondary),
  )
}

export function targetLanguageSelect(
  channelId: string,
  messageId: string,
  languages: readonly TranslationLanguage[] = supportedLanguages,
): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${targetSelectPrefix}${channelId}:${messageId}`)
      .setPlaceholder('選擇要翻譯成哪種語言')
      .addOptions(
        languages.map((language) => ({
          label: languageNames[language],
          value: language,
        })),
      ),
  )
}

export function parseSourceIds(
  customId: string,
  prefix: string,
): { channelId: string; messageId: string } | null {
  if (!customId.startsWith(prefix)) return null
  const [channelId, messageId, extra] = customId.slice(prefix.length).split(':')
  if (
    extra ||
    !/^\d{17,20}$/.test(channelId) ||
    !/^\d{17,20}$/.test(messageId)
  ) {
    return null
  }
  return { channelId, messageId }
}
