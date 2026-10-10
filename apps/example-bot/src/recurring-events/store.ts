import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RecurringEventSchedule } from './types.js'

const defaultDataDirectory = fileURLToPath(
  new URL('../../data', import.meta.url),
)
const dataDirectory = resolve(process.env.BOT_DATA_DIR || defaultDataDirectory)
const storeFile = join(dataDirectory, 'recurring-events.json')

let operationQueue: Promise<unknown> = Promise.resolve()

async function readAll(): Promise<RecurringEventSchedule[]> {
  try {
    const contents = await readFile(storeFile, 'utf8')
    const parsed: unknown = JSON.parse(contents)
    if (!Array.isArray(parsed))
      throw new Error('Recurring event store must contain an array')
    return parsed as RecurringEventSchedule[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeAll(schedules: RecurringEventSchedule[]): Promise<void> {
  await mkdir(dataDirectory, { recursive: true })
  const temporaryFile = `${storeFile}.${process.pid}.tmp`
  await writeFile(
    temporaryFile,
    `${JSON.stringify(schedules, null, 2)}\n`,
    'utf8',
  )
  await rename(temporaryFile, storeFile)
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation)
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export const recurringEventStore = {
  list(guildId?: string): Promise<RecurringEventSchedule[]> {
    return serialize(async () => {
      const schedules = await readAll()
      return guildId
        ? schedules.filter((schedule) => schedule.guildId === guildId)
        : schedules
    })
  },

  add(schedule: RecurringEventSchedule): Promise<void> {
    return serialize(async () => {
      const schedules = await readAll()
      if (
        schedules.some(
          (existing) =>
            existing.guildId === schedule.guildId &&
            existing.sourceEventId === schedule.sourceEventId,
        )
      ) {
        throw new Error('這個活動已設定自訂重複規則。')
      }
      schedules.push(schedule)
      await writeAll(schedules)
    })
  },

  update(schedule: RecurringEventSchedule): Promise<void> {
    return serialize(async () => {
      const schedules = await readAll()
      const index = schedules.findIndex(
        (existing) => existing.id === schedule.id,
      )
      if (index === -1) return
      schedules[index] = schedule
      await writeAll(schedules)
    })
  },

  remove(guildId: string, id: string): Promise<boolean> {
    return serialize(async () => {
      const schedules = await readAll()
      const remaining = schedules.filter(
        (schedule) => schedule.guildId !== guildId || schedule.id !== id,
      )
      if (remaining.length === schedules.length) return false
      await writeAll(remaining)
      return true
    })
  },
}
