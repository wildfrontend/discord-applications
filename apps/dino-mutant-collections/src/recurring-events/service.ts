import {
  type Client,
  escapeMarkdown,
  type GuildScheduledEvent,
  GuildScheduledEventEntityType,
} from 'discord.js'
import { eventNotificationStore, recurringEventStore } from './store.js'
import type { RecurrenceUnit, RecurringEventSchedule } from './types.js'

export function recurrenceMilliseconds(
  interval: number,
  unit: RecurrenceUnit,
): number {
  const unitMilliseconds: Record<RecurrenceUnit, number> = {
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
  }
  return interval * unitMilliseconds[unit]
}

export function buildSchedule(
  source: GuildScheduledEvent,
  createdBy: string,
  interval: number,
  unit: RecurrenceUnit,
): RecurringEventSchedule {
  if (!source.scheduledStartTimestamp) throw new Error('來源活動沒有開始時間。')

  const durationMs = source.scheduledEndTimestamp
    ? source.scheduledEndTimestamp - source.scheduledStartTimestamp
    : null

  if (
    source.entityType === GuildScheduledEventEntityType.External &&
    durationMs === null
  ) {
    throw new Error('外部活動必須設定結束時間。')
  }

  return {
    id: crypto.randomUUID(),
    guildId: source.guildId,
    sourceEventId: source.id,
    latestEventId: source.id,
    createdBy,
    createdAt: new Date().toISOString(),
    interval,
    unit,
    nextStartAt: new Date(
      source.scheduledStartTimestamp + recurrenceMilliseconds(interval, unit),
    ).toISOString(),
    template: {
      name: source.name,
      description: source.description,
      entityType: source.entityType,
      privacyLevel: source.privacyLevel,
      channelId: source.channelId,
      location: source.entityMetadata?.location ?? null,
      durationMs,
    },
  }
}

async function sendOccurrenceNotification(
  client: Client,
  event: GuildScheduledEvent,
): Promise<void> {
  const settings = await eventNotificationStore.get(event.guildId)
  if (!settings) return

  const channel = await client.channels.fetch(settings.channelId)
  if (!channel?.isSendable()) {
    throw new Error(
      `通知頻道 ${settings.channelId} 不存在或 Bot 無法傳送訊息。`,
    )
  }

  const startTimestamp = event.scheduledStartTimestamp
  const time = startTimestamp
    ? `<t:${Math.floor(startTimestamp / 1000)}:F>（<t:${Math.floor(startTimestamp / 1000)}:R>）`
    : '尚未設定'
  await channel.send({
    content: `**新活動已排定｜${escapeMarkdown(event.name)}**\n時間：${time}\n${event.url}`,
    allowedMentions: { parse: [] },
  })
}

export async function createNextOccurrence(
  client: Client,
  schedule: RecurringEventSchedule,
): Promise<RecurringEventSchedule> {
  const guild = await client.guilds.fetch(schedule.guildId)
  const step = recurrenceMilliseconds(schedule.interval, schedule.unit)
  let startTimestamp = Date.parse(schedule.nextStartAt)
  const now = Date.now()

  // Bot 曾離線時略過已經錯過的場次，只補上最近的未來場次。
  while (startTimestamp <= now) startTimestamp += step

  const { template } = schedule
  const existingEvents = await guild.scheduledEvents.fetch()
  const expectedEndTimestamp =
    template.durationMs === null ? null : startTimestamp + template.durationMs
  const existing = existingEvents.find(
    (event) =>
      event.name === template.name &&
      event.entityType === template.entityType &&
      event.channelId === template.channelId &&
      (template.entityType !== GuildScheduledEventEntityType.External ||
        event.entityMetadata?.location === template.location) &&
      event.scheduledStartTimestamp !== null &&
      Math.abs(event.scheduledStartTimestamp - startTimestamp) < 1000 &&
      (expectedEndTimestamp === null ||
        (event.scheduledEndTimestamp !== null &&
          Math.abs(event.scheduledEndTimestamp - expectedEndTimestamp) < 1000)),
  )
  let created = existing
  if (!created) {
    created = await guild.scheduledEvents.create({
      name: template.name,
      description: template.description ?? undefined,
      entityType: template.entityType,
      privacyLevel: template.privacyLevel,
      channel: template.channelId ?? undefined,
      entityMetadata:
        template.entityType === GuildScheduledEventEntityType.External
          ? { location: template.location ?? undefined }
          : undefined,
      scheduledStartTime: new Date(startTimestamp),
      scheduledEndTime:
        template.durationMs === null
          ? undefined
          : new Date(startTimestamp + template.durationMs),
      reason: `Custom recurrence ${schedule.id}`,
    })
    try {
      await sendOccurrenceNotification(client, created)
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      console.error(
        `[events] Failed to notify next occurrence ${created.id}: ${details}`,
      )
    }
  }

  return {
    ...schedule,
    latestEventId: created.id,
    nextStartAt: new Date(startTimestamp + step).toISOString(),
  }
}

export async function createRecurringSchedule(
  client: Client,
  source: GuildScheduledEvent,
  createdBy: string,
  interval: number,
  unit: RecurrenceUnit,
): Promise<RecurringEventSchedule> {
  const schedule = buildSchedule(source, createdBy, interval, unit)
  await recurringEventStore.add(schedule)
  try {
    const withNextOccurrence = await createNextOccurrence(client, schedule)
    await recurringEventStore.update(withNextOccurrence)
    return withNextOccurrence
  } catch (error) {
    await recurringEventStore.remove(schedule.guildId, schedule.id)
    throw error
  }
}
