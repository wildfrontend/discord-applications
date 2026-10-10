import {
  type Client,
  escapeMarkdown,
  Events,
  MessageFlags,
  type TextBasedChannel,
} from 'discord.js'
import {
  originalButton,
  originalButtonPrefix,
  parseSourceIds,
  targetSelectPrefix,
} from './components.js'
import { isTranslationLanguage, languageNames } from './languages.js'
import {
  shouldTranslateMessage,
  translateToLanguage,
  translationContent,
} from './service.js'
import { translationChannelLinkStore } from './store.js'

interface TranslationFeatureOptions {
  automatic: boolean
}

async function fetchSourceMessage(
  client: Client,
  channelId: string,
  messageId: string,
) {
  const channel = await client.channels.fetch(channelId)
  if (!channel?.isTextBased()) return null
  return (channel as TextBasedChannel).messages
    .fetch(messageId)
    .catch(() => null)
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function startTranslationFeature(
  client: Client,
  { automatic }: TranslationFeatureOptions,
): void {
  let lastAutomaticErrorAt = 0

  if (automatic) {
    client.on(Events.MessageCreate, async (message) => {
      if (
        !message.guildId ||
        !message.guild ||
        message.author.bot ||
        message.webhookId ||
        !shouldTranslateMessage(message.content)
      ) {
        return
      }

      const link = await translationChannelLinkStore.get(message.channelId)
      if (!link) return

      const sourceIsA = link.channelAId === message.channelId
      const targetChannelId = sourceIsA
        ? link.channelBId
        : link.channelAId
      const targetLanguage = sourceIsA ? link.languageB : link.languageA

      try {
        const targetChannel = await message.guild.channels.fetch(
          targetChannelId,
        )
        if (!targetChannel?.isSendable()) {
          throw new Error('目標頻道不存在或 Bot 無法傳送訊息。')
        }
        const translated = await translateToLanguage(
          message.content,
          targetLanguage,
        )
        const author = escapeMarkdown(
          message.member?.displayName ?? message.author.displayName,
        )
        const header = `🌐 **${author}**｜[查看原訊息](${message.url})\n`
        const available = 2000 - header.length
        const translatedText =
          translated.text.length <= available
            ? translated.text
            : `${translated.text.slice(0, Math.max(0, available - 1))}…`
        await targetChannel.send({
          content: `${header}${translatedText}`,
          allowedMentions: { parse: [], repliedUser: false },
        })
      } catch (error) {
        const now = Date.now()
        if (now - lastAutomaticErrorAt >= 60_000) {
          lastAutomaticErrorAt = now
          console.error(
            `[translate] Automatic translation failed in channel ${message.channelId}: ${safeErrorMessage(error)}`,
          )
        }
      }
    })
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (
        interaction.isButton() &&
        interaction.customId.startsWith(originalButtonPrefix)
      ) {
        const source = parseSourceIds(
          interaction.customId,
          originalButtonPrefix,
        )
        if (!source) return
        const message = await fetchSourceMessage(
          interaction.client,
          source.channelId,
          source.messageId,
        )
        if (!message) {
          await interaction.reply({
            content: '原始訊息已刪除或無法讀取。',
            flags: MessageFlags.Ephemeral,
          })
          return
        }
        const header = `**原文｜${message.author.displayName}**\n`
        const available = 2000 - header.length
        const original =
          message.content.length <= available
            ? message.content
            : `${message.content.slice(0, Math.max(0, available - 1))}…`
        await interaction.reply({
          content: `${header}${original}`,
          allowedMentions: { parse: [] },
          flags: MessageFlags.Ephemeral,
        })
        return
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith(targetSelectPrefix)
      ) {
        const source = parseSourceIds(interaction.customId, targetSelectPrefix)
        const target = interaction.values[0]
        if (!source || !target || !isTranslationLanguage(target)) return

        await interaction.deferUpdate()
        const message = await fetchSourceMessage(
          interaction.client,
          source.channelId,
          source.messageId,
        )
        if (!message?.content.trim()) {
          await interaction.editReply({
            content: '原始訊息已刪除或沒有可翻譯的文字。',
            components: [],
          })
          return
        }

        const translated = await translateToLanguage(message.content, target)
        await interaction.editReply({
          content: translationContent(translated),
          components: [],
          allowedMentions: { parse: [] },
        })
      }
    } catch (error) {
      console.error(
        `[translate] Component interaction failed: ${safeErrorMessage(error)}`,
      )
      const content = `翻譯失敗：${safeErrorMessage(error)}`.slice(0, 1900)
      if (!interaction.isMessageComponent()) return
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content, components: [] })
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral })
        }
      } catch {
        // Interaction may already be expired; the sanitized error was logged above.
      }
    }
  })

  console.log(
    `[translate] Feature ready (automatic=${automatic ? 'enabled' : 'disabled'}, languages=${Object.values(languageNames).join(', ')})`,
  )
}
