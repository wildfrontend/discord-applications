import { type Client, Events, type Message } from 'discord.js'
import { translationPayloads } from '../translation/message-payload.js'
import {
  consultationConfig,
  consultationDay,
  consultationLimits,
} from './config.js'
import {
  answerConsultation,
  ConsultationError,
  type ConsultationTurn,
} from './service.js'
import { readShareLinks } from './share-links.js'
import { consultationChannelStore, consultationUsageStore } from './store.js'

export function startConsultationFeature(
  client: Client,
  answer: typeof answerConsultation = answerConsultation,
): void {
  if (!consultationConfig().enabled) return
  const limits = consultationLimits()
  const active = new Set<string>()
  const lastRequest = new Map<string, number>()
  const processed = new Map<string, number>()
  const conversations = new Map<
    string,
    { updatedAt: number; turns: ConsultationTurn[] }
  >()
  const retentionMs = 20 * 60_000

  async function reply(
    message: Message<true>,
    text: string,
    status?: Message<true>,
  ) {
    for (const [index, payload] of translationPayloads(
      `🩺 **dr.大暴龍｜符文診斷**\n${text}`,
    ).entries()) {
      const options = {
        ...payload,
        allowedMentions: { parse: [] as const, repliedUser: false },
      }
      if (index === 0 && status) {
        try {
          await status.edit(options)
          continue
        } catch {
          await status.delete().catch(() => {})
        }
      }
      await message.reply(options)
    }
  }

  async function handleMessage(message: Message) {
    const botId = client.user?.id
    if (!botId || !message.inGuild() || message.author.bot || message.webhookId)
      return
    if (
      !message.mentions.users.has(botId) ||
      !new RegExp(`<@!?${botId}>`).test(message.content)
    )
      return
    try {
      if (
        !(await consultationChannelStore.has(
          message.guildId,
          message.channelId,
        ))
      )
        return
      const text = message.content
        .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
        .trim()
      const attachments = [...message.attachments.values()]
      const images = attachments.filter(
        (file) =>
          /^image\/(png|jpe?g|webp)$/i.test(file.contentType ?? '') ||
          /\.(png|jpe?g|webp)$/i.test(file.name),
      )
      if (!text && !images.length) {
        await reply(
          message,
          '請在 @Bot 後輸入問題，或附上 PNG、JPEG、WebP 圖片。',
        )
        return
      }
      if (attachments.length !== images.length) {
        await reply(
          message,
          '諮詢目前只支援 PNG、JPEG、WebP 圖片；請移除其他附件後再詢問。',
        )
        return
      }
      if (
        images.length > 3 ||
        images.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024
      ) {
        await reply(
          message,
          '每次最多可詢問 3 張圖片，圖片總大小請控制在 20 MB 內。',
        )
        return
      }
      try {
        readShareLinks(text)
      } catch (error) {
        if (!(error instanceof ConsultationError)) throw error
        await reply(message, error.message)
        return
      }
      const key = `${message.guildId}:${message.channelId}:${message.author.id}`
      const userId = message.author.id
      const now = Date.now()
      for (const [id, timestamp] of processed) {
        if (now - timestamp > retentionMs) processed.delete(id)
      }
      if (processed.has(message.id)) return
      for (const [entry, timestamp] of lastRequest) {
        if (now - timestamp > retentionMs) lastRequest.delete(entry)
      }
      for (const [entry, conversation] of conversations) {
        if (now - conversation.updatedAt > retentionMs)
          conversations.delete(entry)
      }
      if (active.has(userId)) {
        await reply(message, '正在處理你上一個問題，請稍候再詢問。')
        return
      }
      const remaining =
        limits.cooldownSeconds -
        Math.floor((now - (lastRequest.get(userId) ?? 0)) / 1000)
      if (remaining > 0) {
        await reply(
          message,
          `每人每 ${limits.cooldownSeconds} 秒可問 1 題，請再等 ${remaining} 秒。`,
        )
        return
      }
      if (active.size >= limits.concurrency) {
        await reply(message, 'dr.大暴龍正在診斷其他問題，請稍候再詢問。')
        return
      }
      active.add(userId)
      const typing = setInterval(() => {
        if ('sendTyping' in message.channel)
          void message.channel.sendTyping().catch(() => {})
      }, 8000)
      typing.unref()
      let status: Message<true> | undefined
      try {
        const day = consultationDay(now)
        if (
          !(await consultationUsageStore.claim(
            day,
            userId,
            limits.userDaily,
            limits.botDaily,
          ))
        ) {
          const usage = await consultationUsageStore.get(day, userId)
          await reply(
            message,
            usage.user >= limits.userDaily
              ? `你今天已使用 ${limits.userDaily} 題診斷額度，台灣時間午夜後可再詢問。`
              : `dr.大暴龍今天已達全 Bot ${limits.botDaily} 題的額度，台灣時間午夜後恢復開診。`,
          )
          return
        }
        processed.set(message.id, now)
        if (processed.size > 500)
          processed.delete(processed.keys().next().value as string)
        lastRequest.set(userId, now)
        status = await message.reply({
          content:
            '🩺 **dr.大暴龍｜符文診斷**\n⏳ 正在思考並查詢 Wiki，請稍候…',
          allowedMentions: { parse: [], repliedUser: false },
        })
        if ('sendTyping' in message.channel)
          await message.channel.sendTyping().catch(() => {})
        const history = conversations.get(key)?.turns ?? []
        const result = await answer(
          {
            text,
            images: images.map((image) => image.url),
            history,
          },
          {
            onProgress: async (text) => {
              await status
                ?.edit({
                  content: `🩺 **dr.大暴龍｜符文診斷**\n${text}`,
                  allowedMentions: { parse: [], repliedUser: false },
                })
                .catch(() => {})
            },
          },
        )
        await reply(message, result, status)
        conversations.delete(key)
        conversations.set(key, {
          updatedAt: Date.now(),
          turns: [
            ...history,
            { question: text || '（上一則問題附有圖片）', answer: result },
          ].slice(-4),
        })
        if (conversations.size > 100)
          conversations.delete(conversations.keys().next().value as string)
      } catch (error) {
        await reply(
          message,
          error instanceof ConsultationError
            ? error.message
            : '諮詢暫時無法完成，請稍後再試。',
          status,
        )
      } finally {
        clearInterval(typing)
        active.delete(userId)
      }
    } catch {
      // Avoid logging Discord payloads, signed image URLs, or provider credentials.
      console.error(
        '[consult] Could not process or deliver a consultation reply',
      )
    }
  }
  client.on(Events.MessageCreate, handleMessage)
  client.on(Events.MessageUpdate, async (before, after) => {
    const botId = client.user?.id
    // Only a first explicit mention added to a cached message starts a diagnosis.
    if (
      !botId ||
      before.partial ||
      after.partial ||
      new RegExp(`<@!?${botId}>`).test(before.content)
    )
      return
    await handleMessage(after)
  })
  console.log(
    `[consult] Feature ready (mention-only, model=${consultationConfig().model})`,
  )
}
