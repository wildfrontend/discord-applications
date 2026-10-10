import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultDataDirectory = fileURLToPath(
  new URL('../../data', import.meta.url),
)

export const dataDirectory = resolve(
  process.env.BOT_DATA_DIR || defaultDataDirectory,
)

export function dataFile(name: string): string {
  return join(dataDirectory, name)
}
