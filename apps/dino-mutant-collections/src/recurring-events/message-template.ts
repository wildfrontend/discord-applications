import { escapeMarkdown } from 'discord.js'

export type ReminderPhase = 'start' | 'during' | 'end'

export const DEFAULT_REMINDER_TEMPLATE =
  '{role}\n**活動即將開始｜{name}**\n時間：{time}（{relative}）\n{url}'
const DEFAULT_TEMPLATES: Record<ReminderPhase, string> = {
  start: DEFAULT_REMINDER_TEMPLATE,
  during:
    '{role}\n**活動進行中｜{name}**\n結束：{end}（{end_relative}）\n{url}',
  end: '{role}\n**活動即將結束｜{name}**\n結束：{end}（{end_relative}）\n{url}',
}
const statusLabels: Record<ReminderPhase, string> = {
  start: '即將開始',
  during: '進行中',
  end: '即將結束',
}
export const MAX_REMINDER_TEMPLATE_LENGTH = 1000
const placeholderPattern = /\{([A-Za-z][A-Za-z0-9_-]*)\}/g

interface ReminderVariables {
  name: string
  time: string
  relative: string
  url: string
  role: string
  status: string
  end: string
  end_relative: string
}

function render(template: string, variables: ReminderVariables): string {
  const normalized = template.replace(/\\n/g, '\n')
  const content = normalized.replace(placeholderPattern, (_, key: string) =>
    Object.hasOwn(variables, key)
      ? variables[key as keyof ReminderVariables]
      : `{${key}}`,
  )
  // 設定身分組時，即使樣板沒放 {role} 也維持標註功能。
  return `${variables.role && !normalized.includes('{role}') ? `${variables.role}\n` : ''}${content}`.trim()
}

export function validateReminderTemplate(
  template: string,
  roleId: string | null,
): void {
  if (!template.trim()) throw new Error('提醒訊息樣板不可空白。')
  if (template.length > MAX_REMINDER_TEMPLATE_LENGTH) {
    throw new Error(`提醒訊息樣板最多 ${MAX_REMINDER_TEMPLATE_LENGTH} 個字元。`)
  }
  const example: ReminderVariables = {
    name: escapeMarkdown('\\'.repeat(100)),
    time: '<t:999999999999:F>',
    relative: '<t:999999999999:R>',
    url: 'https://discord.com/events/'.padEnd(120, '9'),
    role: roleId ? `<@&${roleId}>` : '',
    status: '即將結束',
    end: '<t:999999999999:F>',
    end_relative: '<t:999999999999:R>',
  }
  for (const match of template.matchAll(placeholderPattern)) {
    if (!Object.hasOwn(example, match[1])) {
      throw new Error(
        `不支援 {${match[1]}}；可用欄位：{name}、{time}、{relative}、{end}、{end_relative}、{status}、{url}、{role}。`,
      )
    }
  }
  const preview = render(template, example)
  if (!preview) throw new Error('套用樣板後提醒訊息不可空白。')
  if (preview.length > 2000) {
    throw new Error(
      '樣板帶入活動資料後可能超過 2000 個字元，請縮短文案或減少重複欄位。',
    )
  }
}

export function renderReminderMessage(
  event: {
    name: string
    url: string
    scheduledStartTimestamp: number
    scheduledEndTimestamp?: number | null
  },
  roleId: string | null,
  template: string | null,
  phase: ReminderPhase = 'start',
): string {
  const timestamp = Math.floor(event.scheduledStartTimestamp / 1000)
  const end = event.scheduledEndTimestamp
    ? Math.floor(event.scheduledEndTimestamp / 1000)
    : null
  const content = render(template ?? DEFAULT_TEMPLATES[phase], {
    name: escapeMarkdown(event.name),
    time: `<t:${timestamp}:F>`,
    relative: `<t:${timestamp}:R>`,
    url: event.url,
    role: roleId ? `<@&${roleId}>` : '',
    status: statusLabels[phase],
    end: end === null ? '未設定' : `<t:${end}:F>`,
    end_relative: end === null ? '未設定' : `<t:${end}:R>`,
  })
  if (!content || content.length > 2000) {
    throw new Error('提醒訊息必須為 1 到 2000 個字元。')
  }
  return content
}
