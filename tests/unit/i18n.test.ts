import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without type declarations
import { pluralCategory, resolvePluralKey } from '../../src/data/i18n/plural.js'
// @ts-expect-error plain JS module without type declarations
import { findCrossLanguageGaps, findMissingUsedKeys, scanSource } from '../../scripts/i18n-check.mjs'

type Dict = Record<string, string>

const ruGoals: Dict = {
  'goals.activeCount.one': '{n} активная',
  'goals.activeCount.few': '{n} активные',
  'goals.activeCount.many': '{n} активных',
  'goals.activeCount.other': '{n} активных',
}
const has = (dict: Dict) => (k: string) => k in dict

describe('plural selection (Intl.PluralRules)', () => {
  it('maps Russian counts to one / few / many', () => {
    expect(pluralCategory('ru', 1)).toBe('one')
    expect(pluralCategory('ru', 2)).toBe('few')
    expect(pluralCategory('ru', 5)).toBe('many')
    expect(pluralCategory('ru', 21)).toBe('one')
    expect(pluralCategory('ru', 11)).toBe('many')
  })

  it('uses one / other for English and Kyrgyz (app code kg → ky)', () => {
    expect(pluralCategory('en', 1)).toBe('one')
    expect(pluralCategory('en', 3)).toBe('other')
    expect(pluralCategory('kg', 1)).toBe('one')
    expect(pluralCategory('kg', 7)).toBe('other')
  })

  it('picks the matching key: 1 активная / 2 активные / 5 активных', () => {
    const pick = (n: number) => ruGoals[resolvePluralKey(has(ruGoals), 'ru', 'goals.activeCount', n)]
    expect(pick(1)?.replace('{n}', '1')).toBe('1 активная')
    expect(pick(2)?.replace('{n}', '2')).toBe('2 активные')
    expect(pick(5)?.replace('{n}', '5')).toBe('5 активных')
  })

  it('falls back to .other, then null when no form exists', () => {
    const onlyOther: Dict = { 'x.other': 'many x' }
    expect(resolvePluralKey(has(onlyOther), 'ru', 'x', 3)).toBe('x.other')
    expect(resolvePluralKey(has({}), 'ru', 'x', 3)).toBeNull()
  })
})

describe('i18n:check helpers', () => {
  it('extracts static, ternary, plural and dynamic keys', () => {
    const src = [
      "t('a.one')",
      't("a.two", { n })',
      "tp('a.count', n)",
      "t(ok ? 'a.yes' : 'a.no')",
      't(`a.tpl`)',
      't(`a.dyn.${x}`)',
      "format(d, 't')",
    ].join('\n')
    const { keys, dynamic } = scanSource(src)
    expect(keys).toEqual(
      expect.arrayContaining([
        { key: 'a.one', plural: false },
        { key: 'a.two', plural: false },
        { key: 'a.count', plural: true },
        { key: 'a.yes', plural: false },
        { key: 'a.no', plural: false },
        { key: 'a.tpl', plural: false },
      ]),
    )
    expect(keys).toHaveLength(6)
    expect(dynamic).toEqual(['a.dyn.'])
  })

  it('reports keys missing across languages, except plural forms a language does not use', () => {
    const dicts = {
      en: { a: 'A', 'n.one': '1', 'n.other': 'x' },
      kg: { 'n.one': '1', 'n.other': 'x' },
      ru: { a: 'А', 'n.one': '1', 'n.few': '2', 'n.many': '5', 'n.other': 'x' },
    }
    expect(findCrossLanguageGaps(dicts)).toEqual([{ lang: 'kg', key: 'a' }])
  })

  it('requires the plural forms each language needs for tp() usages', () => {
    const dicts = {
      en: { 'n.one': '1', 'n.other': 'x' },
      kg: { 'n.other': 'x' },
      ru: { 'n.one': '1', 'n.other': 'x' },
    }
    const missing = findMissingUsedKeys([{ key: 'n', plural: true, file: 'f.jsx' }], dicts)
    expect(missing.map((m: { lang: string; key: string }) => `${m.lang}:${m.key}`)).toEqual([
      'kg:n.one',
      'ru:n.few',
      'ru:n.many',
    ])
  })
})
