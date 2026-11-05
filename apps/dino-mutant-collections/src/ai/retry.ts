import { deferAiRequests, enqueueAiRequest } from './request-queue.js'

export class RetryableAiError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs = 0,
  ) {
    super(message)
  }
}

export function retryAfterMs(value: string | null): number {
  if (!value?.trim()) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0
}

// Each attempt observes the shared request interval. Apply provider cooldowns
// before releasing the queue, including to requests that are already waiting.
export async function requestAiWithRetry<T>(
  request: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await enqueueAiRequest(async () => {
        try {
          return await request()
        } catch (error) {
          if (
            error instanceof RetryableAiError &&
            error.retryAfterMs <= 60_000
          ) {
            deferAiRequests(Math.max(1_000 * 2 ** attempt, error.retryAfterMs))
          }
          throw error
        }
      })
    } catch (error) {
      if (
        !(error instanceof RetryableAiError) ||
        attempt >= 2 ||
        error.retryAfterMs > 60_000
      ) {
        throw error
      }
      const delay = Math.max(1_000 * 2 ** attempt, error.retryAfterMs)
      console.warn(
        `[ai] Retrying request (${attempt + 2}/3) in ${delay}ms: ${error.message}`,
      )
    }
  }
}
