const configuredInterval = Number(
  process.env.AI_MIN_REQUEST_INTERVAL_MS?.trim() || Number.NaN,
)
const minimumRequestIntervalMs = Number.isFinite(configuredInterval)
  ? Math.max(0, configuredInterval)
  : 2_100

let requestQueue: Promise<void> = Promise.resolve()
let nextRequestAt = 0

export function deferAiRequests(delayMs: number): void {
  nextRequestAt = Math.max(nextRequestAt, Date.now() + delayMs)
}

// Translation and tower recognition share the provider's request budget.
export function enqueueAiRequest<T>(request: () => Promise<T>): Promise<T> {
  const scheduled = requestQueue.then(async () => {
    while (nextRequestAt > Date.now()) {
      await new Promise((resolve) =>
        setTimeout(resolve, nextRequestAt - Date.now()),
      )
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
