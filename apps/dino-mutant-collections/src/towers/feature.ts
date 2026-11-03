import { type Client, Events, type Message } from 'discord.js'
import { type TowerImageClient, towerImageClient } from './ai-client.js'
import { type TowerTextKey, towerLanguage, towerText } from './i18n.js'
import { observeTower, renderTowerSummary } from './service.js'
import { towerStore } from './store.js'

const maxImageBytes = 20 * 1024 * 1024

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

  let updated = false
  let unreadable = 0
  let failed = 0
  let unsupported = 0
  let wrongServer = 0
  for (const image of images.values()) {
    let url: URL
    try {
      url = new URL(image.url)
    } catch {
      unsupported++
      continue
    }
    if (
      image.size > maxImageBytes ||
      !(image.contentType
        ? /^image\/(?:png|jpeg|webp)$/i.test(image.contentType)
        : /\.(?:png|jpe?g|webp)$/i.test(image.name)) ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
    ) {
      unsupported++
      continue
    }
    try {
      const result = await imageClient.recognize(image.url)
      if (result.kind !== 'tower') {
        unreadable++
        continue
      }
      if (result.reading.serverNumber !== binding.serverNumber) {
        wrongServer++
        continue
      }
      updated =
        (await towerStore.save(
          binding,
          observeTower(
            result.reading,
            message.createdTimestamp,
            message.id,
            image.id,
          ),
        )) || updated
    } catch {
      failed++
      console.warn(
        `[towers] Image processing failed in channel ${message.channelId}`,
      )
    }
  }

  if (
    (await towerStore.getBinding(message.guildId, message.channelId))?.id !==
    binding.id
  )
    return
  const notices = [
    wrongServer > 0
      ? text('wrongServer', {
          count: wrongServer,
          server: binding.serverNumber,
        })
      : '',
    unreadable > 0 ? text('unreadable', { count: unreadable }) : '',
    unsupported > 0 ? text('unsupported', { count: unsupported }) : '',
    failed > 0 ? text('failed', { count: failed }) : '',
  ].filter(Boolean)
  const content =
    [
      updated
        ? renderTowerSummary(
            binding.serverNumber,
            await towerStore.list(binding),
            language,
          )
        : '',
      ...notices,
    ]
      .filter(Boolean)
      .join('\n\n') || text('noUpdate')

  // Send plain text without replying to or embedding the image message.
  // If posting the result fails, retain the source so the upload is not lost silently.
  const resultMessage = await message.channel.send({
    content,
    allowedMentions: { parse: [], repliedUser: false },
  })

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
  const queues = new Map<string, Promise<void>>()
  client.on(Events.MessageCreate, (message) => {
    if (
      !message.inGuild() ||
      message.author.bot ||
      message.webhookId ||
      message.attachments.size === 0
    )
      return
    const previous = queues.get(message.channelId) ?? Promise.resolve()
    const work = previous
      .then(() => handleTowerMessage(message))
      .catch(() => {
        console.warn(
          `[towers] Unable to process message in channel ${message.channelId}`,
        )
      })
    queues.set(message.channelId, work)
    void work.then(() => {
      if (queues.get(message.channelId) === work)
        queues.delete(message.channelId)
    })
  })
}
