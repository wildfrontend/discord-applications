import { escapeMarkdown } from 'discord.js'
import type { TranslationLanguage } from '../translation/languages.js'
import { towerText } from './i18n.js'

export const towerAreas = [7, 8, 9, 12, 14, 17, 18, 19] as const
export type TowerArea = (typeof towerAreas)[number]
export const maximumShieldSeconds = 48 * 60 * 60

export interface TowerReading {
  serverNumber: number
  area: TowerArea
  occupyingTribe: string
  remainingSeconds: number
}

export interface TowerObservation extends TowerReading {
  observedAt: number
  availableAt: number
  sourceMessageId: string
  sourceAttachmentId: string
}

export type TowerRecognition =
  | { kind: 'tower'; reading: TowerReading }
  | { kind: 'unrelated' }
  | { kind: 'unreadable' }

export function isTowerArea(value: number): value is TowerArea {
  return towerAreas.some((area) => area === value)
}

export function parseShieldDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/)
  if (!match) return null
  const seconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return seconds <= maximumShieldSeconds ? seconds : null
}

// Validate model output independently of JSON mode; never infer missing fields.
export function parseTowerRecognition(value: unknown): TowerRecognition {
  if (typeof value !== 'object' || value === null) return { kind: 'unreadable' }
  const data = value as Record<string, unknown>
  if (data.isTowerScreenshot === false) return { kind: 'unrelated' }
  if (data.isTowerScreenshot !== true) return { kind: 'unreadable' }
  const location =
    typeof data.location === 'string'
      ? data.location.trim().match(/^(\d{1,6})\s*-\s*(\d{1,2})$/)
      : null
  if (!location || Number(location[1]) < 1) return { kind: 'unreadable' }
  const area = Number(location[2])
  if (!isTowerArea(area)) return { kind: 'unrelated' }
  const remainingSeconds = parseShieldDuration(data.shieldRemaining)
  const tribe =
    typeof data.occupyingTribe === 'string'
      ? data.occupyingTribe.replace(/\s+/g, ' ').trim()
      : ''
  if (
    remainingSeconds === null ||
    !tribe ||
    tribe.length > 80 ||
    /[\p{Cc}<>]/u.test(tribe) ||
    tribe === '[-]' ||
    tribe === '-'
  )
    return { kind: 'unreadable' }
  return {
    kind: 'tower',
    reading: {
      serverNumber: Number(location[1]),
      area,
      occupyingTribe: tribe,
      remainingSeconds,
    },
  }
}

export function observeTower(
  reading: TowerReading,
  uploadedAt: number,
  sourceMessageId: string,
  sourceAttachmentId: string,
): TowerObservation {
  if (!Number.isSafeInteger(uploadedAt) || uploadedAt < 0) {
    throw new Error('圖片上傳時間無效。')
  }
  return {
    ...reading,
    observedAt: uploadedAt,
    availableAt: uploadedAt + reading.remainingSeconds * 1000,
    sourceMessageId,
    sourceAttachmentId,
  }
}

const japaneseTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatJapaneseTime(timestamp: number): string {
  const parts = Object.fromEntries(
    japaneseTime
      .formatToParts(timestamp)
      .map(({ type, value }) => [type, value]),
  )
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

export function renderTowerSummary(
  serverNumber: number,
  observations: readonly TowerObservation[],
  language: TranslationLanguage = 'ja',
): string {
  const byArea = new Map(
    observations
      .filter((item) => item.serverNumber === serverNumber)
      .map((item) => [item.area, item]),
  )
  return [
    towerText(language, 'title'),
    ...towerAreas.map((area) => {
      const item = byArea.get(area)
      if (!item)
        return `- ${serverNumber}-${area} ${towerText(language, 'empty')}`
      return `- ${serverNumber}-${area} ${escapeMarkdown(item.occupyingTribe)} ${formatJapaneseTime(item.availableAt)}（<t:${Math.floor(item.availableAt / 1000)}:R>）`
    }),
    towerText(language, 'estimate'),
  ].join('\n')
}
