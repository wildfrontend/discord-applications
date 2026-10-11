import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'

const applicationId = (process.env.DISCORD_CLIENT_ID || 'default').replace(
  /[^a-zA-Z0-9_-]/g,
  '_',
)
const lockFile = join(
  tmpdir(),
  `dc-dino-mutant-collections-${applicationId}.lock`,
)

interface LockOwner {
  pid: number
  hostname: string
  startedAt: string
}

function readOwner(): LockOwner | null {
  try {
    return JSON.parse(readFileSync(lockFile, 'utf8')) as LockOwner
  } catch {
    return null
  }
}

function isLocalProcessAlive(owner: LockOwner | null): boolean {
  if (!owner || owner.hostname !== hostname()) return false
  try {
    process.kill(owner.pid, 0)
    return true
  } catch {
    return false
  }
}

function tryAcquire(): (() => void) | null {
  let descriptor: number
  try {
    descriptor = openSync(lockFile, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return null
  }

  const owner: LockOwner = {
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  }
  writeFileSync(descriptor, JSON.stringify(owner), 'utf8')
  closeSync(descriptor)

  let released = false
  const release = () => {
    if (released) return
    released = true
    const currentOwner = readOwner()
    if (
      currentOwner?.pid === owner.pid &&
      currentOwner.hostname === owner.hostname
    ) {
      try {
        unlinkSync(lockFile)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          const details = error instanceof Error ? error.message : String(error)
          console.error(`[bot] Failed to release process lock: ${details}`)
        }
      }
    }
  }

  process.once('exit', release)
  return release
}

export function acquireBotProcessLock(): () => void {
  const acquired = tryAcquire()
  if (acquired) return acquired

  const owner = readOwner()
  if (!isLocalProcessAlive(owner)) {
    try {
      unlinkSync(lockFile)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const retried = tryAcquire()
    if (retried) return retried
  }

  const ownerDescription = owner
    ? `pid=${owner.pid} host=${owner.hostname} started=${owner.startedAt}`
    : 'unknown owner'
  throw new Error(
    `Another bot process is already running (${ownerDescription}). Stop it before starting another instance.`,
  )
}
