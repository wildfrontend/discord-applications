import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultDataDirectory = fileURLToPath(
  new URL('../../data', import.meta.url),
)

export const dataDirectory = resolve(
  process.env.BOT_DATA_DIR || defaultDataDirectory,
)

mkdirSync(dataDirectory, { recursive: true })

export function dataFile(name: string): string {
  return join(dataDirectory, name)
}
