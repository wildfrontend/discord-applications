const queues = new Map<string, Promise<unknown>>()

export function withTowerChannelLock<T>(
  channelId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(channelId) ?? Promise.resolve()
  const scheduled = previous.then(work, work)
  const settled = scheduled.then(
    () => undefined,
    () => undefined,
  )
  queues.set(channelId, settled)
  void settled.then(() => {
    if (queues.get(channelId) === settled) queues.delete(channelId)
  })
  return scheduled
}
