import { describe, expect, it } from 'vitest'
import { firstWord, greetingKey, greetingName } from './dashboardModel'
import { formatMoney } from '../../../utils/format'

const NBSP = String.fromCharCode(160)
const clean = (s) => s.replace(/[\u00a0\u202f]/g, ' ')

describe('greetingName', () => {
  it('uses only the first word of the display name', () => {
    expect(greetingName({ displayName: '  Марат   Асанов ' }, null)).toBe('Марат')
  })

  it('prefers the profile first name, then falls back to the auth user', () => {
    expect(greetingName({ firstName: 'Айгүл', displayName: 'A B' }, null)).toBe('Айгүл')
    expect(greetingName(null, { displayName: 'John Smith' })).toBe('John')
  })

  it('returns an empty string when there is no usable name', () => {
    expect(greetingName(null, null)).toBe('')
    expect(firstWord(42)).toBe('')
  })
})

describe('greetingKey', () => {
  it('picks morning / afternoon / evening by hour', () => {
    expect(greetingKey(new Date(2026, 0, 1, 8))).toBe('dash.greetingMorning')
    expect(greetingKey(new Date(2026, 0, 1, 13))).toBe('dash.greetingAfternoon')
    expect(greetingKey(new Date(2026, 0, 1, 21))).toBe('dash.greetingEvening')
  })
})

describe('formatMoney', () => {
  it('spells KGS as "сом" in ru/kg and "som" in en', () => {
    expect(formatMoney(0, 'KGS', 'ru')).toBe(`0${NBSP}сом`)
    expect(formatMoney(0, 'KGS', 'kg')).toBe(`0${NBSP}сом`)
    expect(formatMoney(0, 'KGS', 'en')).toBe(`0${NBSP}som`)
    expect(clean(formatMoney(-1234.5, 'KGS', 'ru'))).toBe('-1 234,5 сом')
  })

  it('keeps other stored currencies and falls back to KGS for unknown ones', () => {
    expect(formatMoney(1234.5, 'USD', 'en')).toBe('$1,234.5')
    expect(clean(formatMoney(10, 'RUB', 'ru'))).toBe('10 ₽')
    expect(formatMoney(5, 'XYZ', 'en')).toBe(`5${NBSP}som`)
  })

  it('never prints NaN or -0', () => {
    expect(formatMoney(undefined)).toBe(`0${NBSP}сом`)
    expect(formatMoney(-0, 'KGS', 'en')).toBe(`0${NBSP}som`)
  })
})
