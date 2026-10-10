import type { Client } from 'discord.js'
import { createNextOccurrence, recurrenceMilliseconds } from './service.js'
import { recurringEventStore } from './store.js'

const CHECK_INTERVAL_MS = 60_000

async function runScheduler(client: Client): Promise<void> {
  const schedules = await recurringEventStore.list()

  for (const schedule of schedules) {
    const step = recurrenceMilliseconds(schedule.interval, schedule.unit)
    const nextStart = Date.parse(schedule.nextStartAt)
    const previousStart = nextStart - step

    // 保持一場未來活動：最近建立的活動開始後，才建立再下一場。
    if (Date.now() < previousStart) continue

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

export function startRecurringEventScheduler(client: Client): NodeJS.Timeout {
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

  void check()
  const timer = setInterval(check, CHECK_INTERVAL_MS)
  timer.unref()
  return timer
}
