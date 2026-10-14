import { ConsultationError } from './ai-client.js'

interface Slot {
  runeId: string
  level: number
  active?: boolean
}
interface Bonus {
  source: '星座' | '皮膚' | '其他'
  stat: string
  mode: 'flat' | 'pct'
  value: number
}
export interface SharedLoadout {
  name: string
  side: 'self' | 'foe'
  base: Partial<Record<'hp' | 'atk' | 'spd', number>>
  slots: Slot[]
  bonuses: Bonus[]
}
export interface SharedConsultation {
  text: string
  loadouts: SharedLoadout[]
  inventories: Array<{
    name: string
    runes: Array<{ runeId: string; level: number }>
  }>
}

const stats = {
  hp: 'hp',
  atk: 'atk',
  spd: 'spd',
  atkTitan: 'at',
  atkBuilding: 'ab',
  crit: 'cr',
  critDmg: 'cd',
  defUnit: 'du',
  defTitan: 'dt',
} as const
const invalid = () =>
  new ConsultationError(
    '配置分享連結的資料不完整或格式不正確，請回網站按「分享」重新複製；符文等級須為 1–31。',
  )

function number(value: string, maximum: number): number {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw invalid()
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed > maximum) throw invalid()
  return parsed
}
function rune(value: string, withActive: boolean): Slot {
  const parts = value.split('.')
  if (
    parts.length < 2 ||
    parts.length > (withActive ? 3 : 2) ||
    !/^r\d{2,4}$/.test(parts[0] ?? '')
  )
    throw invalid()
  const level = number(parts[1] ?? '', 31)
  if (!Number.isInteger(level) || level < 1) throw invalid()
  const active = parts[2]
  if (active !== undefined && active !== '0' && active !== '1') throw invalid()
  return {
    runeId: parts[0] as string,
    level,
    ...(active === undefined ? {} : { active: active === '1' }),
  }
}

// The Wiki stores its share state in the URL fragment, which HTTP never sends
// to the server. Decode locally; never fetch arbitrary member-provided URLs.
export function readShareLinks(text: string): SharedConsultation {
  const result: SharedConsultation = { text, loadouts: [], inventories: [] }
  let foundSite = false
  const seen = new Set<string>()
  result.text = text.replace(/https?:\/\/[^\s<>[\]"`)）。，、]+/g, (raw) => {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return raw
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'dino-mutant-wiki.vercel.app' ||
      url.port ||
      url.username ||
      url.password
    )
      return raw
    if (url.pathname !== '/' && url.pathname !== '/inventory') return raw
    foundSite = true
    if (raw.length > 12000) throw invalid()
    const params = new URLSearchParams(url.hash.slice(1))
    if (params.get('v') && !['1', '2'].includes(params.get('v') as string))
      throw invalid()
    for (const key of params.keys())
      if (params.getAll(key).length > 1) throw invalid()
    if (params.has('inv')) {
      const entries = (params.get('inv') ?? '').split('-').filter(Boolean)
      if (entries.length > 50) throw invalid()
      const runes = entries.map((entry) => {
        const { runeId, level } = rune(entry, false)
        return { runeId, level }
      })
      if (new Set(runes.map((entry) => entry.runeId)).size !== runes.length)
        throw invalid()
      const key = JSON.stringify(runes)
      if (!seen.has(key)) {
        seen.add(key)
        result.inventories.push({
          name: (params.get('inv_name') ?? '符文清單').slice(0, 20),
          runes,
        })
      }
    }
    for (const side of ['self', 'foe'] as const) {
      const prefix = side === 'self' ? '' : 'o_'
      if (!['hp', 'atk', 'spd', 's'].some((key) => params.has(prefix + key)))
        continue
      const loadout: SharedLoadout = {
        name: (
          params.get(`${prefix}name`) ?? (side === 'self' ? '配置 A' : '配置 B')
        ).slice(0, 40),
        side,
        base: {},
        slots: [],
        bonuses: [],
      }
      for (const stat of ['hp', 'atk', 'spd'] as const) {
        const value = params.get(prefix + stat)
        if (value !== null) loadout.base[stat] = number(value, 1_000_000_000)
      }
      const slots = params.get(`${prefix}s`)
      if (slots) {
        const entries = slots.split('-')
        if (entries.length > 5) throw invalid()
        loadout.slots = entries.map((entry) => rune(entry, true))
      }
      for (const [source, code] of [
        ['星座', 'c'],
        ['皮膚', 'k'],
        ['其他', 'x'],
      ] as const) {
        for (const [stat, abbreviation] of Object.entries(stats)) {
          if (source === '皮膚' && stat !== 'hp' && stat !== 'atk') continue
          const modes: Bonus['mode'][] =
            ['crit', 'critDmg'].includes(stat) || source === '皮膚'
              ? ['pct']
              : ['defUnit', 'defTitan'].includes(stat)
                ? ['flat']
                : ['flat', 'pct']
          for (const mode of modes) {
            const value = params.get(
              `${prefix}${code}${abbreviation}${mode === 'pct' ? 'p' : ''}`,
            )
            if (value !== null) {
              const parsed = number(
                value,
                mode === 'pct' ? 100_000_000 : 1_000_000,
              )
              loadout.bonuses.push({
                source,
                stat,
                mode,
                value: mode === 'pct' ? parsed / 100 : parsed,
              })
            }
          }
        }
      }
      const key = JSON.stringify({
        base: loadout.base,
        slots: loadout.slots,
        bonuses: loadout.bonuses,
      })
      if (!seen.has(key)) {
        seen.add(key)
        result.loadouts.push(loadout)
      }
    }
    return '（Wiki 分享資料已讀取）'
  })
  if (result.loadouts.length > 2 || result.inventories.length > 2)
    throw new ConsultationError(
      '一次最多分析 2 套配置與 2 份符文清單，請分次貼上分享連結。',
    )
  if (foundSite && !result.loadouts.length && !result.inventories.length)
    throw new ConsultationError(
      '這個網址沒有配裝資料。請先在 Wiki 填好配置，按「分享」複製完整連結（包含 # 後的資料）再貼給我。',
    )
  return result
}
