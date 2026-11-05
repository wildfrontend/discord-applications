import { type Client, Events, type Message } from 'discord.js'
import { type TowerImageClient, towerImageClient } from './ai-client.js'
import { deliverTowerDraft, startTowerDraftInteractions } from './draft-flow.js'
import { type TowerTextKey, towerLanguage, towerText } from './i18n.js'
import { stageTowerImages } from './ingestion.js'
import { withTowerChannelLock } from './queue.js'
import { towerStore } from './store.js'
import { startTowerUploadInteractions } from './upload-flow.js'

function isUnknownMessage(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 10008
  )
}

export async function handleTowerMessage(
  message: Message,
  imageClient: TowerImageClient = towerImageClient,
): Promise<void> {
  if (!message.inGuild() || message.author.bot || message.webhookId) return
  if (message.attachments.size === 0) return
  const binding = await towerStore.getBinding(
    message.guildId,
    message.channelId,
  )
  if (!binding) return
  const images = message.attachments.filter((attachment) =>
    attachment.contentType
      ? /^image\//i.test(attachment.contentType)
      : /\.(?:png|jpe?g|webp|gif|heic|avif)$/i.test(attachment.name),
  )
  if (images.size === 0) return
  const language = towerLanguage(await towerStore.getLocale(message.author.id))
  const text = (
    key: TowerTextKey,
    values: Record<string, string | number> = {},
  ) => towerText(language, key, values)

  const draft = await stageTowerImages(
    binding,
    message.author.id,
    message.createdTimestamp,
    message.id,
    images.values(),
    imageClient,
  )
  if (!draft) return
  const { message: resultMessage, content } = await deliverTowerDraft(
    message,
    binding,
    draft,
    language,
  )

  let cleanupNotice: TowerTextKey | undefined
  try {
    if (images.size !== message.attachments.size) {
      cleanupNotice = 'sourceHasFiles'
    } else {
      // Don't delete new attachments added while recognition was running.
      const current = await message.fetch(true)
      if (
        current.attachments.size !== images.size ||
        !current.attachments.every((attachment) => images.has(attachment.id))
      ) {
        cleanupNotice = 'sourceChanged'
      } else if (!current.deletable) {
        cleanupNotice = 'cleanupMissing'
      } else if (
        (await towerStore.getBinding(message.guildId, message.channelId))
          ?.id === binding.id
      ) {
        // The analysis-only channel discards failed and successful image posts, including captions.
        await current.delete()
      }
    }
  } catch (error) {
    if (!isUnknownMessage(error)) {
      cleanupNotice = 'cleanupFailed'
      console.warn(
        `[towers] Unable to delete source message in channel ${message.channelId}`,
      )
    }
  }
  if (cleanupNotice) {
    await resultMessage.edit({
      content: `${content}\n\n${text(cleanupNotice)}`,
      allowedMentions: { parse: [] },
    })
  }
}

export function startTowerFeature(client: Client): void {
  startTowerDraftInteractions(client)
  startTowerUploadInteractions(client)
  client.on(Events.InteractionCreate, async (interaction) => {
    // MessageCreate has no locale. Remember Discord's locale from real interactions.
    await towerStore
      .rememberLocale(
        interaction.user.id,
        interaction.locale,
        interaction.createdTimestamp,
      )
      .catch(() => {
        console.warn('[towers] Unable to remember user locale')
      })
  })
  client.on(Events.MessageCreate, (message) => {
    if (
      !message.inGuild() ||
      message.author.bot ||
      message.webhookId ||
      message.attachments.size === 0
    )
      return
    void withTowerChannelLock(message.channelId, () =>
      handleTowerMessage(message),
    ).catch(() => {
      console.warn(
        `[towers] Unable to process message in channel ${message.channelId}`,
      )
    })
  })
}
