import { describe, it, expect } from 'vitest'
import { normalize, tokenize, stem, wordSimilarity } from './text'

describe('normalize', () => {
  it('lowercases, unifies ё and strips punctuation', () => {
    expect(normalize('Ёлка, ЁЖ!  Run-fast?')).toBe('елка еж run fast')
  })

  it('keeps Kyrgyz letters ң ү ө', () => {
    expect(normalize('Ден соолугумду ЧЫҢДОО, үй-бүлө!')).toBe('ден соолугумду чыңдоо үй бүлө')
  })
})

describe('tokenize', () => {
  it('drops stop words in all three languages', () => {
    expect(tokenize('I want to run a marathon')).toEqual(['run', 'marathon'])
    expect(tokenize('Я хочу пробежать марафон')).toEqual(['пробежать', 'марафон'])
    expect(tokenize('Мен марафон чуркагым келет')).toEqual(['марафон', 'чуркагым'])
  })

  it('returns an empty array for empty input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize(null)).toEqual([])
  })
})

describe('stem', () => {
  it('maps inflected forms to the same stem', () => {
    expect(stem('здоровье')).toBe(stem('здоровым'))
    expect(stem('соолугу')).toBe(stem('соолуктун'))
  })

  it('keeps short words intact', () => {
    expect(stem('бег')).toBe('бег')
  })
})

describe('wordSimilarity', () => {
  it('is 1 for identical words and high for inflections', () => {
    expect(wordSimilarity('марафон', 'марафон')).toBe(1)
    expect(wordSimilarity('марафона', 'марафон')).toBeGreaterThan(0.6)
  })

  it('is low for unrelated words', () => {
    expect(wordSimilarity('деньги', 'марафон')).toBeLessThan(0.3)
  })
})
