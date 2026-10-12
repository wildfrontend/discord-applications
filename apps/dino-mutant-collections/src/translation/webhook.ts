import type { TextChannel, Webhook } from 'discord.js'

const translationWebhookName = 'Dino 翻譯'
const translationWebhooks = new Map<string, Promise<Webhook>>()

interface TranslationWebhookMessage {
  avatarURL: string
  content: string
  username: string
}

export async function sendTranslationWebhook(
  channel: TextChannel,
  botUserId: string,
  message: TranslationWebhookMessage,
): Promise<void> {
  const cachedWebhook = translationWebhooks.get(channel.id)
  const createOrFindWebhook =
    cachedWebhook ??
    (async () => {
      const webhooks = await channel.fetchWebhooks()
      const existing = webhooks.find(
        (webhook) =>
          webhook.isIncoming() &&
          webhook.owner?.id === botUserId &&
          webhook.name === translationWebhookName,
      )
      return (
        existing ??
        (await channel.createWebhook({
          name: translationWebhookName,
          reason: '以原發言者的暱稱與頭像顯示翻譯訊息',
        }))
      )
    })()

  if (!cachedWebhook) {
    translationWebhooks.set(channel.id, createOrFindWebhook)
  }

  try {
    const webhook = await createOrFindWebhook
    await webhook.send({
      content: message.content,
      username: message.username.slice(0, 80),
      avatarURL: message.avatarURL,
      allowedMentions: { parse: [], repliedUser: false },
    })
  } catch (error) {
    translationWebhooks.delete(channel.id)
    throw error
  }
}
