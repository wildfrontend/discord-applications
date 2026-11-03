import { type Client, Events, type Message } from 'discord.js'
import { type TowerImageClient, towerImageClient } from './ai-client.js'
import { observeTower, renderTowerSummary } from './service.js'
import { towerStore } from './store.js'

const maxImageBytes = 20 * 1024 * 1024

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
      if (result.kind === 'unrelated') continue
      if (result.kind === 'unreadable') {
        unreadable++
        continue
      }
      if (result.reading.serverNumber !== binding.serverNumber) {
        wrongServer++
        continue
      }
      const saved = await towerStore.save(
        binding,
        observeTower(
          result.reading,
          message.createdTimestamp,
          message.id,
          image.id,
        ),
      )
      updated = saved || updated
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
      ? `已忽略 ${wrongServer} 張其他伺服器圖片；此頻道只記錄 ${binding.serverNumber} 服。`
      : '',
    unreadable > 0
      ? `${unreadable} 張圖片欄位不完整，未記錄；請上傳含右下角地圖、佔領部落與護盾倒數的清晰截圖。`
      : '',
    unsupported > 0
      ? `${unsupported} 張圖片格式或大小不支援；請使用 20 MB 以內的 PNG、JPEG 或 WebP。`
      : '',
    failed > 0
      ? `${failed} 張圖片辨識失敗，未記錄；請稍後重新上傳，或請管理員檢查 AI 設定與額度。`
      : '',
  ].filter(Boolean)
  const content = [
    updated
      ? renderTowerSummary(binding.serverNumber, await towerStore.list(binding))
      : '',
    ...notices,
  ]
    .filter(Boolean)
    .join('\n\n')
  if (content)
    await message.reply({
      content,
      allowedMentions: { parse: [], repliedUser: false },
    })
}

export function startTowerFeature(client: Client): void {
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
