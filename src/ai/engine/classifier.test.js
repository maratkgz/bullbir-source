import { describe, it, expect } from 'vitest'
import { classifyGoal, learnFromChoice } from './classifier'

const domain = (id, kw) => ({ id, keywords: { en: kw.en, kg: kw.kg, ru: kw.ru } })

const DOMAINS = [
  domain('health', { en: ['health', 'marathon', 'run', 'weight'], kg: ['ден соолук', 'чуркоо', 'марафон'], ru: ['здоровье', 'марафон', 'бег', 'похудеть'] }),
  domain('finance', { en: ['money', 'save', 'budget'], kg: ['акча', 'топтоо'], ru: ['деньги', 'накопить', 'бюджет'] }),
  domain('universal', { en: ['goal'], kg: ['максат'], ru: ['цель'] }),
]

describe('classifyGoal', () => {
  it('ranks the matching domain first in every language', () => {
    expect(classifyGoal('Пробежать марафон к октябрю', DOMAINS)[0].id).toBe('health')
    expect(classifyGoal('Накопить деньги на квартиру', DOMAINS)[0].id).toBe('finance')
    expect(classifyGoal('Акча топтогум келет', DOMAINS)[0].id).toBe('finance')
    expect(classifyGoal('Run my first marathon', DOMAINS)[0].id).toBe('health')
  })

  it('matches inflected forms', () => {
    expect(classifyGoal('Хочу заботиться о здоровья', DOMAINS)[0].id).toBe('health')
  })

  it('falls back to the universal domain when nothing matches', () => {
    const [top] = classifyGoal('Научиться играть на гитаре', DOMAINS)
    expect(top.id).toBe('universal')
    expect(top.isFallback).toBe(true)
  })

  it('returns confidences that sum to at most 1', () => {
    const ranked = classifyGoal('марафон и деньги', DOMAINS)
    const sum = ranked.reduce((s, r) => s + r.confidence, 0)
    expect(sum).toBeLessThanOrEqual(1.0001)
  })

  it('uses learned feedback to change the ranking', () => {
    const goal = 'Научиться играть на гитаре'
    const feedback = learnFromChoice({}, goal, 'finance')
    expect(classifyGoal(goal, DOMAINS, { feedback })[0].id).toBe('finance')
  })
})

describe('learnFromChoice', () => {
  it('does not mutate the previous feedback object', () => {
    const before = {}
    const after = learnFromChoice(before, 'гитара', 'finance')
    expect(before).toEqual({})
    expect(after).not.toBe(before)
  })
})
