import type { Client } from 'discord.js'
import { createNextOccurrence, recurrenceMilliseconds } from './service.js'
import { recurringEventStore } from './store.js'

const CHECK_INTERVAL_MS = 1_000
const CACHE_REFRESH_INTERVAL_MS = 5 * 60_000

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
  const check = async () => {
    if (running) return
    running = true
    try {
      await runScheduler(client)
    } catch (error) {
      console.error('[events] Scheduler failed:', error)
    } finally {
      running = false
    }
  }

  void refreshScheduledEventCaches(client).then(check)
  const cacheTimer = setInterval(
    () => void refreshScheduledEventCaches(client),
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
