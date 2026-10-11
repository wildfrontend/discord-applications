import {
  ChannelType,
  type Client,
  Events,
  escapeMarkdown,
  type Message,
  MessageFlags,
  type TextBasedChannel,
  type Webhook,
} from 'discord.js'
import { aiTranslationClient } from './ai-client.js'
import {
  originalButtonPrefix,
  parseSourceIds,
  targetSelectPrefix,
} from './components.js'
import { isTranslationLanguage, languageNames } from './languages.js'
import {
  shouldTranslateMessage,
  translateToLanguage,
  translateToLanguages,
  translationContent,
} from './service.js'
import { translationChannelLinkStore, translationGroupStore } from './store.js'

interface TranslationFeatureOptions {
  automatic: boolean
}

const translationWebhookName = 'Dino 翻譯'
const translationWebhooks = new Map<string, Promise<Webhook>>()

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

async function sendTranslatedMessage(
  message: Message<true>,
  targetChannelId: string,
  targetLanguage: Parameters<typeof translateToLanguage>[1],
): Promise<void> {
  const translated = await translateToLanguage(message.content, targetLanguage)
  await sendTranslatedText(message, targetChannelId, translated.text)
}

async function sendTranslatedText(
  message: Message<true>,
  targetChannelId: string,
  translatedText: string,
): Promise<void> {
  const targetChannel = await message.guild.channels.fetch(targetChannelId)
  if (targetChannel?.type !== ChannelType.GuildText) {
    throw new Error(`目標頻道 ${targetChannelId} 不存在或 Bot 無法傳送訊息。`)
  }
  const sourceLink = `\n-# [查看原訊息](${message.url})`
  const available = 2000 - sourceLink.length
  const content =
    translatedText.length <= available
      ? translatedText
      : `${translatedText.slice(0, Math.max(0, available - 1))}…`
  const webhookPromise = translationWebhooks.get(targetChannelId)
  const createOrFindWebhook =
    webhookPromise ??
    (async () => {
      const webhooks = await targetChannel.fetchWebhooks()
      const existing = webhooks.find(
        (webhook) =>
          webhook.isIncoming() &&
          webhook.owner?.id === message.client.user.id &&
          webhook.name === translationWebhookName,
      )
      return (
        existing ??
        (await targetChannel.createWebhook({
          name: translationWebhookName,
          reason: '以原發言者的暱稱與頭像顯示自動翻譯',
        }))
      )
    })()

  if (!webhookPromise)
    translationWebhooks.set(targetChannelId, createOrFindWebhook)

  try {
    const webhook = await createOrFindWebhook
    const username = (
      message.member?.displayName ?? message.author.displayName
    ).slice(0, 80)
    const avatarURL =
      message.member?.displayAvatarURL({ extension: 'png', size: 128 }) ??
      message.author.displayAvatarURL({ extension: 'png', size: 128 })
    await webhook.send({
      content: `${content}${sourceLink}`,
      username,
      avatarURL,
      allowedMentions: { parse: [], repliedUser: false },
    })
  } catch (error) {
    translationWebhooks.delete(targetChannelId)
    const author = escapeMarkdown(
      message.member?.displayName ?? message.author.displayName,
    )
    console.warn(
      `[translate] Webhook delivery unavailable in channel ${targetChannelId}; falling back to bot message: ${safeErrorMessage(error)}`,
    )
    await targetChannel.send({
      content: `**${author}**｜[查看原訊息](${message.url})\n${content}`,
      allowedMentions: { parse: [], repliedUser: false },
    })
  }
}

export function startTranslationFeature(
  client: Client,
  { automatic }: TranslationFeatureOptions,
): void {
  let lastAutomaticErrorAt = 0

  if (!process.env.AI_API_KEY?.trim()) {
    console.warn(
      '[translate] AI_API_KEY is missing; translation requests will fail until it is configured and the bot is restarted.',
    )
  }

  if (automatic) {
    client.on(Events.MessageCreate, async (message) => {
      if (
        !message.inGuild() ||
        message.author.bot ||
        message.webhookId ||
        !shouldTranslateMessage(message.content)
      ) {
        return
      }

      const groupMember = await translationGroupStore.getMember(
        message.channelId,
      )

      try {
        if (groupMember) {
          const members = await translationGroupStore.list(
            groupMember.categoryId,
          )
          const targets = members.filter(
            (member) => member.channelId !== message.channelId,
          )
          const translations = await translateToLanguages(
            message.content,
            targets.map((target) => target.language),
          )
          const translationsByLanguage = new Map(
            translations.map((translation) => [
              translation.target,
              translation.text,
            ]),
          )
          const results = await Promise.allSettled(
            targets.map((target) => {
              const translatedText = translationsByLanguage.get(target.language)
              if (translatedText === undefined) {
                return Promise.reject(
                  new Error(`缺少 ${languageNames[target.language]}翻譯結果。`),
                )
              }
              return sendTranslatedText(
                message,
                target.channelId,
                translatedText,
              )
            }),
          )
          const failed = results.find(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected',
          )
          if (failed) throw failed.reason
          return
        }

        const link = await translationChannelLinkStore.get(message.channelId)
        if (!link) return
        const sourceIsA = link.channelAId === message.channelId
        await sendTranslatedMessage(
          message,
          sourceIsA ? link.channelBId : link.channelAId,
          sourceIsA ? link.languageB : link.languageA,
        )
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
    `[translate] Feature ready (automatic=${automatic ? 'enabled' : 'disabled'}, provider=${aiTranslationClient.name}, languages=${Object.values(languageNames).join(', ')})`,
  )
}
