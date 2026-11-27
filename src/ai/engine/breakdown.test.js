import { describe, it, expect } from 'vitest'
import { breakdownMilestone, pickSequence, fitSteps } from './breakdown'
import stepsLibrary from '../library/steps.json'
import { LANGS, STEP_COUNT } from '../library/schema'

const L = (s) => ({ en: `${s} en`, kg: `${s} kg`, ru: `${s} ru` })
const tplSteps = [10, 20, 30, 40, 90, 15].map((minutes, k) => ({ ...L(`S${k}`), minutes }))
const DOMAIN = {
  id: 'demo',
  directions: Array.from({ length: 8 }, (_, d) => ({
    title: L(`D${d}`),
    actions: Array.from({ length: 8 }, (__, a) => (d === 1 && a === 2 ? { ...L('Goal'), type: 'milestone', steps: tplSteps } : L(`A${a}`))),
  })),
}

describe('steps library', () => {
  it('is well-formed, trilingual and uses real Kyrgyz letters', () => {
    expect(stepsLibrary.sequences.map((s) => s.id)).toContain('generic')
    stepsLibrary.sequences.forEach((seq) => {
      expect(seq.steps.length).toBeGreaterThanOrEqual(STEP_COUNT.min)
      expect(seq.steps.length).toBeLessThanOrEqual(STEP_COUNT.max)
      seq.steps.forEach((s) => {
        LANGS.forEach((l) => expect(typeof s[l] === 'string' && s[l].trim().length > 0).toBe(true))
        expect(Number.isInteger(s.minutes) && s.minutes >= 5 && s.minutes <= 120).toBe(true)
      })
    })
    const kg = JSON.stringify(stepsLibrary.sequences.map((s) => s.steps.map((x) => x.kg)))
    expect(kg).toMatch(/[ңүө]/)
    expect(kg).not.toMatch(/[а-яёңүө][a-z]+[а-яёңүө]/iu)
  })
})

describe('pickSequence', () => {
  it.each([
    ['Сдать IELTS на 7', 'exam'],
    ['Pass the driving exam', 'exam'],
    ['Экзаменди тапшыруу', 'exam'],
    ['Накопить на квартиру', 'saving'],
    ['Save money for a car', 'saving'],
    ['Акча топтоо', 'saving'],
    ['Запустить интернет-магазин', 'launch'],
    ['Launch a website', 'launch'],
    ['Научиться играть на гитаре', 'skill'],
    ['Переехать к морю', 'generic'],
    ['', 'generic'],
  ])('%s → %s', (text, id) => expect(pickSequence(text).id).toBe(id))
})

describe('fitSteps', () => {
  it('splits long steps into parts and never exceeds 12 steps', () => {
    const out = fitSteps([{ title: 'A', minutes: 90 }, { title: 'B', minutes: 10 }], 30)
    expect(out.map((s) => s.title)).toEqual(['A (1/3)', 'A (2/3)', 'A (3/3)', 'B'])
    expect(out.every((s) => s.minutes <= 30)).toBe(true)
    const many = fitSteps(Array.from({ length: 10 }, (_, k) => ({ title: `S${k}`, minutes: 120 })), 10)
    expect(many).toHaveLength(12)
    expect(many.every((s) => s.minutes <= 10)).toBe(true)
  })
})

describe('breakdownMilestone', () => {
  it('uses the template steps when the src resolves to one', () => {
    const cell = { text: 'Goal ru', src: 'demo:1:2@1' }
    const { steps } = breakdownMilestone(cell, { minutesPerDay: 30, lang: 'ru', domains: [DOMAIN] })
    expect(steps[0]).toEqual({ title: 'S0 ru', minutes: 10 })
    expect(steps.map((s) => s.title)).toContain('S3 ru (1/2)')
    expect(steps.every((s) => s.minutes <= 30)).toBe(true)
    expect(steps.length).toBeGreaterThanOrEqual(5)
    expect(steps.length).toBeLessThanOrEqual(12)
  })

  it('falls back to a generic sequence picked by keywords', () => {
    const { steps } = breakdownMilestone({ text: 'Накопить на ноутбук', src: '' }, { minutesPerDay: 20, lang: 'kg' })
    expect(steps[0].title).toBe(stepsLibrary.sequences.find((s) => s.id === 'saving').steps[0].kg)
    expect(steps.every((s) => s.minutes <= 20)).toBe(true)
    expect(steps.length).toBeGreaterThanOrEqual(5)
    expect(steps.length).toBeLessThanOrEqual(12)
  })

  it('handles tiny budgets and missing options', () => {
    const tiny = breakdownMilestone({ text: 'Whatever' }, { minutesPerDay: 1 }).steps
    expect(tiny.every((s) => s.minutes <= 5)).toBe(true)
    expect(tiny.length).toBeLessThanOrEqual(12)
    expect(breakdownMilestone(null).steps.length).toBeGreaterThanOrEqual(5)
  })

  it('does not mutate the input cell', () => {
    const cell = Object.freeze({ text: 'Сдать экзамен', src: '' })
    expect(() => breakdownMilestone(cell)).not.toThrow()
  })
})
