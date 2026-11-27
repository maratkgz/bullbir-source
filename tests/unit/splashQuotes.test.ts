import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without type declarations
import { PERSONAL_QUOTES, SPLASH_QUOTES, pickSplashQuote } from '../../src/data/splashQuotes.js'

describe('splash quotes', () => {
  it('has quotes in every language', () => {
    for (const lang of ['ru', 'kg', 'en']) {
      expect(SPLASH_QUOTES[lang].length).toBeGreaterThanOrEqual(10)
    }
  })

  it('keeps the personal phrases exactly as written', () => {
    expect(PERSONAL_QUOTES).toEqual(['будтэ сабими самий', 'симу сою римя'])
  })

  it('can pick a personal phrase in any language', () => {
    for (const lang of ['ru', 'kg', 'en']) {
      expect(pickSplashQuote(lang, () => 0.9999)).toBe('симу сою римя')
    }
  })

  it('falls back to Russian for an unknown language', () => {
    expect(pickSplashQuote('xx', () => 0)).toBe(SPLASH_QUOTES.ru[0])
  })
})
