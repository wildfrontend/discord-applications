import {
  type Client,
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
  translateAcrossBinding,
  translateToLanguage,
  translationContent,
} from './service.js'
import { translationBindingStore } from './store.js'

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
        message.author.bot ||
        message.webhookId ||
        !shouldTranslateMessage(message.content)
      ) {
        return
      }

      const binding = await translationBindingStore.get(message.channelId)
      if (!binding) return

      try {
        const translated = await translateAcrossBinding(
          message.content,
          binding,
        )
        if (!translated) return
        await message.reply({
          content: translationContent(translated),
          components: [originalButton(message.channelId, message.id)],
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
