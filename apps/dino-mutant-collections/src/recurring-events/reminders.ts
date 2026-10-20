import {
  type Client,
  DiscordAPIError,
  GuildScheduledEventStatus,
} from 'discord.js'
import {
  type ReminderPhase,
  renderReminderMessage,
} from './message-template.js'
import {
  type EventNotificationSettings,
  eventNotificationStore,
  eventReminderStore,
} from './store.js'

const MINUTE = 60_000

type ReminderTiming = Pick<
  EventNotificationSettings,
  'remindBeforeMinutes' | 'remindBeforeEndMinutes' | 'repeatEveryMinutes'
>

interface ReminderTrigger {
  at: number
  phase: ReminderPhase
}

/** 列出一場活動在 until 之前的所有提醒時間點（依時間排序）。 */
export function reminderTriggers(
  timing: ReminderTiming,
  start: number,
  end: number | null,
  until: number,
): ReminderTrigger[] {
  const triggers: ReminderTrigger[] = []
  if (timing.remindBeforeMinutes > 0) {
    triggers.push({
      at: start - timing.remindBeforeMinutes * MINUTE,
      phase: 'start',
    })
  }
  const endReminderAt =
    end !== null && timing.remindBeforeEndMinutes
      ? end - timing.remindBeforeEndMinutes * MINUTE
      : null
  if (endReminderAt !== null && endReminderAt > start) {
    triggers.push({ at: endReminderAt, phase: 'end' })
  }
  if (timing.repeatEveryMinutes) {
    // 進行中提醒持續到結束前提醒（或活動結束）為止。
    const stop = Math.min(
      endReminderAt !== null && endReminderAt > start
        ? endReminderAt
        : (end ?? Number.POSITIVE_INFINITY),
      until,
    )
    const step = timing.repeatEveryMinutes * MINUTE
    for (let at = start + step; at < stop; at += step) {
      triggers.push({ at, phase: 'during' })
    }
  }
  return triggers
    .filter((trigger) => trigger.at < until)
    .sort((left, right) => left.at - right.at)
}

/**
 * 找出目前該送的提醒：只取最新一個已到期的時間點，Bot 離線後不會補發整串提醒。
 * done 表示這場活動已沒有後續提醒。
 */
export function nextReminder(
  timing: ReminderTiming,
  start: number,
  end: number | null,
  lastTriggerAt: number | null,
  now: number,
): { due: ReminderTrigger | null; done: boolean } {
  // 涵蓋所有剩餘提醒；沒有結束時間時，往後多看一個進行中提醒週期。
  const horizon =
    Math.max(now, start, end ?? 0) +
    (timing.repeatEveryMinutes ?? 0) * MINUTE +
    1
  const triggers = reminderTriggers(timing, start, end, horizon).filter(
    (trigger) => lastTriggerAt === null || trigger.at > lastTriggerAt,
  )
  const due = triggers.filter((trigger) => trigger.at <= now).at(-1) ?? null
  return { due, done: !triggers.some((trigger) => trigger.at > now) && !due }
}

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
      const planned = nextReminder(
        settings,
        reminder.startAt,
        reminder.endAt,
        reminder.lastTriggerAt,
        now,
      )
      if (!planned.due) {
        if (planned.done) {
          await eventReminderStore.complete(
            reminder.scheduleId,
            reminder.eventId,
          )
        }
        continue
      }

      const guild = await client.guilds.fetch(reminder.guildId)
      // 發送前重新取得活動，避免通知已取消的活動或沿用舊的時間。
      const event = await guild.scheduledEvents
        .fetch(reminder.eventId)
        .catch((error) => {
          if (error instanceof DiscordAPIError && error.status === 404)
            return null
          throw error
        })
      if (
        !event ||
        event.scheduledStartTimestamp === null ||
        event.status === GuildScheduledEventStatus.Canceled ||
        event.status === GuildScheduledEventStatus.Completed
      ) {
        await eventReminderStore.complete(reminder.scheduleId, reminder.eventId)
        continue
      }
      const start = event.scheduledStartTimestamp
      const end = event.scheduledEndTimestamp
      await eventReminderStore.track(reminder.scheduleId, event.id, start, end)
      const current = Date.now()
      const { due } = nextReminder(
        settings,
        start,
        end,
        reminder.lastTriggerAt,
        current,
      )
      if (!due) continue

      const stillRelevant =
        due.phase === 'start'
          ? event.status === GuildScheduledEventStatus.Scheduled &&
            current < start
          : end !== null
            ? current < end
            : event.status === GuildScheduledEventStatus.Active
      if (stillRelevant) {
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
            {
              name: event.name,
              url: event.url,
              scheduledStartTimestamp: start,
              scheduledEndTimestamp: end,
            },
            settings.roleId,
            settings.messageTemplate,
            due.phase,
          ),
          allowedMentions: {
            parse: [],
            roles: settings.roleId ? [settings.roleId] : [],
          },
        })
      }
      // 錯過的提醒（例如活動已開始才輪到開始前提醒）直接略過。
      await eventReminderStore.markTriggered(
        reminder.scheduleId,
        event.id,
        due.at,
      )
      if (nextReminder(settings, start, end, due.at, current).done) {
        await eventReminderStore.complete(reminder.scheduleId, event.id)
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      console.error(
        `[events] Failed to remind event ${reminder.eventId}: ${details}`,
      )
    }
  }
}
