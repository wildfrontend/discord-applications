import type { Client } from 'discord.js'
import { sendDueEventReminders } from './reminders.js'
import { createNextOccurrence, recurrenceMilliseconds } from './service.js'
import { eventReminderStore, recurringEventStore } from './store.js'

const CHECK_INTERVAL_MS = 1_000
const CACHE_REFRESH_INTERVAL_MS = 5 * 60_000
const REMINDER_CHECK_INTERVAL_MS = 30_000

async function refreshScheduledEventCaches(client: Client): Promise<void> {
  const results = await Promise.allSettled(
    client.guilds.cache.map((guild) => guild.scheduledEvents.fetch()),
  )
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length > 0) {
    console.error(
      `[events] Failed to refresh ${failures.length} guild event cache(s)`,
    )
  }
  // 也補上舊排程和來源活動；更新時間時不會清除已發送紀錄。
  for (const schedule of await recurringEventStore.list()) {
    const events = client.guilds.cache.get(schedule.guildId)?.scheduledEvents
      .cache
    for (const id of new Set([
      schedule.sourceEventId,
      schedule.latestEventId,
    ])) {
      const event = events?.get(id)
      if (
        event?.scheduledStartTimestamp &&
        event.scheduledStartTimestamp > Date.now()
      ) {
        await eventReminderStore.track(
          schedule.id,
          id,
          event.scheduledStartTimestamp,
        )
      }
    }
  }
}

async function runScheduler(client: Client): Promise<void> {
  const schedules = await recurringEventStore.list()

  for (const schedule of schedules) {
    const step = recurrenceMilliseconds(schedule.interval, schedule.unit)
    const nextStart = Date.parse(schedule.nextStartAt)
    const previousStart = nextStart - step

    // 保持一場未來活動：最近建立的活動開始後，才建立再下一場。
    const isPendingFirstOccurrence =
      schedule.latestEventId === schedule.sourceEventId
    if (!isPendingFirstOccurrence && Date.now() < previousStart) continue

    try {
      const updated = await createNextOccurrence(client, schedule)
      await recurringEventStore.update(updated)
      console.log(
        `[events] Created next occurrence for ${schedule.template.name}`,
      )
    } catch (error) {
      console.error(
        `[events] Failed to extend ${schedule.template.name}:`,
        error,
      )
    }
  }
}

export function startRecurringEventScheduler(client: Client): () => void {
  let running = false
  let nextReminderCheck = 0
  const check = async () => {
    if (running) return
    running = true
    try {
      await runScheduler(client)
      if (Date.now() >= nextReminderCheck) {
        nextReminderCheck = Date.now() + REMINDER_CHECK_INTERVAL_MS
        await sendDueEventReminders(client)
      }
    } catch (error) {
      console.error('[events] Scheduler failed:', error)
    } finally {
      running = false
    }
  }

  const refresh = () =>
    refreshScheduledEventCaches(client).catch((error) => {
      console.error('[events] Failed to refresh reminders:', error)
    })
  void refresh().then(check)
  const cacheTimer = setInterval(
    () => void refresh(),
    CACHE_REFRESH_INTERVAL_MS,
  )
  cacheTimer.unref()
  const timer = setInterval(check, CHECK_INTERVAL_MS)
  timer.unref()
  return () => {
    clearInterval(cacheTimer)
    clearInterval(timer)
  }
}
