const configuredInterval = Number(process.env.AI_MIN_REQUEST_INTERVAL_MS)
const minimumRequestIntervalMs = Number.isFinite(configuredInterval)
  ? Math.max(0, configuredInterval)
  : 2_100

let requestQueue: Promise<void> = Promise.resolve()
let nextRequestAt = 0

// Translation and tower recognition share the provider's request budget.
export function enqueueAiRequest<T>(request: () => Promise<T>): Promise<T> {
  const scheduled = requestQueue.then(async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now())
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
    nextRequestAt = Date.now() + minimumRequestIntervalMs
    return request()
  })
  requestQueue = scheduled.then(
    () => undefined,
    () => undefined,
  )
  return scheduled
}
