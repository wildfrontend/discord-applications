import type {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} from 'discord.js'

export type RecurrenceUnit = 'days' | 'weeks'

export interface RecurringEventSchedule {
  id: string
  guildId: string
  sourceEventId: string
  latestEventId: string
  createdBy: string
  createdAt: string
  interval: number
  unit: RecurrenceUnit
  nextStartAt: string
  template: {
    name: string
    description: string | null
    entityType: GuildScheduledEventEntityType
    privacyLevel: GuildScheduledEventPrivacyLevel
    channelId: string | null
    location: string | null
    durationMs: number | null
  }
}
