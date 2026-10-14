export const defaultWikiUrl = 'https://dino-mutant-wiki.vercel.app/mcp'
export const wikiToolNames = [
  'search_runes',
  'get_rune',
  'get_titan_damage',
  'simulate_loadout',
] as const

function integerSetting(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= maximum
    ? value
    : fallback
}

export function consultationLimits() {
  return {
    cooldownSeconds: integerSetting('CONSULTATION_COOLDOWN_SECONDS', 60, 3600),
    userDaily: integerSetting('CONSULTATION_USER_DAILY_LIMIT', 10, 10000),
    botDaily: integerSetting('CONSULTATION_BOT_DAILY_LIMIT', 100, 100000),
    concurrency: integerSetting('CONSULTATION_MAX_CONCURRENT', 1, 3),
  }
}

export function consultationDay(timestamp = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp)
}

export function consultationConfig() {
  return {
    enabled: process.env.CONSULTATION_ENABLED === 'true',
    apiKey:
      process.env.CONSULTATION_AI_API_KEY?.trim() ||
      process.env.AI_WIKI_KEY?.trim() ||
      process.env.AI_API_KEY?.trim() ||
      '',
    baseUrl: (
      process.env.CONSULTATION_AI_BASE_URL?.trim() ||
      process.env.AI_BASE_URL?.trim() ||
      'https://api.groq.com/openai/v1'
    ).replace(/\/$/, ''),
    model:
      process.env.CONSULTATION_AI_MODEL?.trim() ||
      process.env.AI_MODEL?.trim() ||
      'qwen/qwen3.8-27b',
    mcpUrl: process.env.CONSULTATION_MCP_URL?.trim() || defaultWikiUrl,
  }
}
