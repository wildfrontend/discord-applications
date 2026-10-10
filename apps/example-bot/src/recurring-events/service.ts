import {
  type Client,
  type GuildScheduledEvent,
  GuildScheduledEventEntityType,
} from 'discord.js'
import { recurringEventStore } from './store.js'
import type { RecurrenceUnit, RecurringEventSchedule } from './types.js'

export function recurrenceMilliseconds(
  interval: number,
  unit: RecurrenceUnit,
): number {
  const days = unit === 'weeks' ? interval * 7 : interval
  return days * 24 * 60 * 60 * 1000
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
  const created = await guild.scheduledEvents.create({
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
  const schedules = await recurringEventStore.list(source.guildId)
  if (schedules.some((schedule) => schedule.sourceEventId === source.id)) {
    throw new Error('這個活動已設定自訂重複規則。')
  }

  const schedule = buildSchedule(source, createdBy, interval, unit)
  const withNextOccurrence = await createNextOccurrence(client, schedule)
  await recurringEventStore.add(withNextOccurrence)
  return withNextOccurrence
}
