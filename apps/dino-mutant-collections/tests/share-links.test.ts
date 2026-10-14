import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readShareLinks } from '../src/consultation/share-links.js'

const origin = 'https://dino-mutant-wiki.vercel.app/'
const configuration =
  'v=2&name=我的暴龍&hp=1780&atk=100&spd=150&s=r09.5.1-r38.2.0&chpp=27&cat=12&katkp=9'

test('decodes actual Wiki v2 slots, conditions and extra bonus units', () => {
  const result = readShareLinks(`請診斷 <${origin}#${configuration}>`)
  assert.equal(result.loadouts.length, 1)
  assert.equal(result.loadouts[0]?.name, '我的暴龍')
  assert.deepEqual(result.loadouts[0]?.base, { hp: 1780, atk: 100, spd: 150 })
  assert.deepEqual(result.loadouts[0]?.slots, [
    { runeId: 'r09', level: 5, active: true },
    { runeId: 'r38', level: 2, active: false },
  ])
  assert.deepEqual(result.loadouts[0]?.bonuses, [
    { source: '星座', stat: 'hp', mode: 'pct', value: 0.27 },
    { source: '星座', stat: 'atkTitan', mode: 'flat', value: 12 },
    { source: '皮膚', stat: 'atk', mode: 'pct', value: 0.09 },
  ])
  assert.equal(result.text.includes('#v=2'), false)
})

test('reads a full matchup share bundle and deduplicates individual configuration links', () => {
  const foe = 'o_name=對手&o_hp=2000&o_atk=200&o_spd=180&o_s=r01.1.1'
  const result = readShareLinks(
    [
      `${origin}#${configuration}&compare=1&${foe}`,
      `${origin}#${configuration}`,
      `${origin}#name=對手&hp=2000&atk=200&spd=180&s=r01.1.1`,
      `${origin}inventory#inv=r09.5-r38.2&inv_name=我的符文`,
      `${origin}inventory#inv=r01.1&inv_name=對手符文`,
    ].join('\n'),
  )
  assert.equal(result.loadouts.length, 2)
  assert.equal(result.loadouts[1]?.side, 'foe')
  assert.equal(result.inventories.length, 2)
  assert.deepEqual(result.inventories[0]?.runes, [
    { runeId: 'r09', level: 5 },
    { runeId: 'r38', level: 2 },
  ])
})

test('preserves missing stats and activation rather than assuming website defaults', () => {
  const result = readShareLinks(`${origin}#s=r09.5`)
  assert.deepEqual(result.loadouts[0]?.base, {})
  assert.deepEqual(result.loadouts[0]?.slots, [{ runeId: 'r09', level: 5 }])
})

test('rejects malformed, duplicated, unsupported and oversized configuration data', () => {
  for (const hash of [
    's=r09.32.1',
    's=r09.0.1',
    's=r09.2.yes',
    's=unknown.1.1',
    'hp=NaN',
    'hp=-1',
    'hp=1000000001',
    'atk=1&atk=2',
    'v=3&s=r09.1.1',
    `s=${Array(6).fill('r09.1.1').join('-')}`,
    'inv=r09.1-r09.2',
  ])
    assert.throws(() => readShareLinks(`${origin}#${hash}`), /格式不正確/)
  assert.throws(() => readShareLinks(origin), /按「分享」/)
  assert.throws(
    () => readShareLinks(`${origin}#${'name=x&'.repeat(2000)}hp=1`),
    /格式不正確/,
  )
  assert.throws(
    () => readShareLinks([1, 2, 3].map((hp) => `${origin}#hp=${hp}`).join(' ')),
    /最多分析 2 套/,
  )
})

test('ignores lookalike hosts and arbitrary URLs, and handles Discord/Markdown link boundaries', () => {
  const arbitrary =
    'https://dino-mutant-wiki.vercel.app.evil.test/#hp=1 https://localhost/#hp=1 https://dino-mutant-wiki.vercel.app@evil.test/#hp=1'
  assert.deepEqual(readShareLinks(arbitrary), {
    text: arbitrary,
    loadouts: [],
    inventories: [],
  })
  const result = readShareLinks(
    `[我的配置](${origin}#${configuration})。請比較`,
  )
  assert.equal(result.loadouts.length, 1)
  assert.ok(result.text.endsWith(')。請比較'))
})
