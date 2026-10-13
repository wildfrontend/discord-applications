import {
  type Client,
  DiscordAPIError,
  GuildScheduledEventStatus,
} from 'discord.js'
import { renderReminderMessage } from './message-template.js'
import { eventNotificationStore, eventReminderStore } from './store.js'

export async function sendDueEventReminders(client: Client): Promise<void> {
  const now = Date.now()
  const pending = await eventReminderStore.pending(now)
  for (const reminder of pending) {
    try {
      const settings = await eventNotificationStore.resolve(
        reminder.guildId,
        reminder.scheduleId,
      )
      if (!settings?.enabled) continue
      const leadMs = settings.remindBeforeMinutes * 60_000
      if (now < reminder.startAt - leadMs) continue

      const guild = await client.guilds.fetch(reminder.guildId)
      // 發送前重新取得活動，避免通知已取消的活動或沿用舊的開始時間。
      const event = await guild.scheduledEvents
        .fetch(reminder.eventId)
        .catch((error) => {
          if (error instanceof DiscordAPIError && error.status === 404)
            return null
          throw error
        })
      if (
        !event ||
        event.status !== GuildScheduledEventStatus.Scheduled ||
        event.scheduledStartTimestamp === null ||
        event.scheduledStartTimestamp <= Date.now()
      ) {
        await eventReminderStore.complete(reminder.scheduleId, reminder.eventId)
        continue
      }
      const start = event.scheduledStartTimestamp
      await eventReminderStore.track(reminder.scheduleId, event.id, start)
      if (Date.now() < start - leadMs) continue

      const channel = await client.channels.fetch(settings.channelId)
      if (
        !channel?.isSendable() ||
        !('guildId' in channel) ||
        channel.guildId !== reminder.guildId
      ) {
        throw new Error('提醒頻道不存在或 Bot 無法傳送訊息。')
      }
      await channel.send({
        content: renderReminderMessage(
          { name: event.name, url: event.url, scheduledStartTimestamp: start },
          settings.roleId,
          settings.messageTemplate,
        ),
        allowedMentions: {
          parse: [],
          roles: settings.roleId ? [settings.roleId] : [],
        },
      })
      await eventReminderStore.complete(reminder.scheduleId, event.id)
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      console.error(
        `[events] Failed to remind event ${reminder.eventId}: ${details}`,
      )
    }
  }
}
