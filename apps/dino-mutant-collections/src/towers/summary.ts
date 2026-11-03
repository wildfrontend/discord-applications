import type { Message } from 'discord.js'
import type { TranslationLanguage } from '../translation/languages.js'
import {
  renderTowerSummary,
  towerAreas,
  towerReportingPeriodMs,
} from './service.js'
import {
  type TowerBinding,
  type TowerReportingPeriod,
  towerStore,
} from './store.js'

export interface TowerSummarySource {
  channel: Message<true>['channel']
  client: { user: { id: string } }
  createdTimestamp: number
}

function isMissingMessage(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 10008
  )
}

export async function currentReportingPeriod(
  source: TowerSummarySource,
  binding: TowerBinding,
): Promise<TowerReportingPeriod | null> {
  const observations = await towerStore.list(binding)
  const current = await towerStore.getReportingPeriod(binding)
  if (current) return current
  if (!current && binding.adoptExistingSummary) {
    // Adopt the existing bot summary once when upgrading an already configured channel.
    const messages = await source.channel.messages.fetch({ limit: 50 })
    const previous = messages.find(
      (item) =>
        item.author.id === source.client.user.id &&
        item.createdTimestamp <= source.createdTimestamp &&
        towerAreas.every((area) =>
          item.content
            .split('\n')
            .some((line) =>
              line.startsWith(`- ${binding.serverNumber}-${area} `),
            ),
        ),
    )
    if (previous) {
      const priorUploads = observations.filter(
        (item) =>
          item.uploadedAt <= previous.createdTimestamp &&
          item.uploadedAt >= previous.createdTimestamp - towerReportingPeriodMs,
      )
      const startedAt = Math.min(
        previous.createdTimestamp,
        ...priorUploads.map((item) => item.uploadedAt),
      )
      if (source.createdTimestamp < startedAt + towerReportingPeriodMs) {
        const adopted = await towerStore.createReportingPeriod(
          binding,
          startedAt,
        )
        await towerStore.setReportingMessage(binding, adopted.id, previous.id)
        return { ...adopted, messageId: previous.id }
      }
    }
  }
  return null
}

export async function updateTowerSummary(
  source: TowerSummarySource,
  binding: TowerBinding,
  language: TranslationLanguage,
  notices: readonly string[],
  target?: TowerReportingPeriod,
): Promise<{ message: Message<true>; content: string }> {
  let period = target ?? (await currentReportingPeriod(source, binding))
  if (!period || (!target && source.createdTimestamp >= period.endsAt)) {
    period = await towerStore.createReportingPeriod(
      binding,
      source.createdTimestamp,
    )
  }
  if (!target) {
    for (const item of await towerStore.list(binding))
      await towerStore.savePeriodObservation(binding, period, item)
  }
  const observations = await towerStore.listPeriodObservations(binding, period)
  const content = [
    renderTowerSummary(binding.serverNumber, observations, language, period),
    ...notices,
  ]
    .filter(Boolean)
    .join('\n\n')
  const payload = { content, allowedMentions: { parse: [] } }
  if (period.messageId) {
    let existing: Message<true> | null = null
    try {
      existing = await source.channel.messages.fetch({
        message: period.messageId,
        force: true,
      })
    } catch (error) {
      if (!isMissingMessage(error)) throw error
    }
    if (existing) {
      if (existing.author.id !== source.client.user.id)
        throw new Error('Tower summary is not owned by this bot')
      try {
        return { message: await existing.edit(payload), content }
      } catch (error) {
        if (!isMissingMessage(error)) throw error
      }
    }
  }
  // Deleted summaries are replaced within the same period; normal updates edit in place.
  const message = await source.channel.send(payload)
  await towerStore.setReportingMessage(binding, period.id, message.id)
  return { message, content }
}
