import { describe, it, expect } from 'vitest'
import { INTERVIEW_STEPS, nextStep, applyAnswer, parseMinutes, parseMinutesStrict, isVagueAnswer } from './interview'
import { BUILTIN_DOMAINS } from '../library/index'

const FULL = {
  life: 'Работаю менеджером, двое детей',
  goal: 'Пробежать марафон к октябрю',
  why: 'Хочу доказать себе, что могу',
  has: 'Бегаю по 3 км иногда',
  failures: 'Бросал бег зимой',
  obstacles: 'Мало времени после работы',
  minutes: '40 минут',
}

describe('parseMinutes', () => {
  it.each([
    ['30', 30], ['30 мин', 30], ['45 минут', 45], ['1 час', 60], ['2 часа', 120], ['полчаса', 30],
    ['1.5 hours', 90], ['1,5 часа', 90], ['1 саат', 60], ['жарым саат', 30], ['20 мүнөт', 20],
    ['1 час 30 минут', 90], ['полтора часа', 90], ['an hour', 60], ['15 min', 15],
    ['2', 5], ['600', 240], ['10 hours', 240],
    ['не знаю', 30], ['', 30], [undefined, 30],
  ])('%s → %i', (text, expected) => expect(parseMinutes(text)).toBe(expected))

  it('strict version returns null when nothing is recognised', () => {
    expect(parseMinutesStrict('много')).toBeNull()
    expect(parseMinutesStrict('час')).toBe(60)
  })
})

describe('isVagueAnswer', () => {
  it.each([
    ['why', 'не знаю', true], ['why', 'хз', true], ['why', 'idk', true], ['why', 'Билбейм', true],
    ['why', 'деньги', true], ['why', '', true], ['why', 'Хочу больше энергии', false],
    ['minutes', '30', false], ['minutes', 'много', true],
  ])('%s: “%s” → %s', (step, text, expected) => expect(isVagueAnswer(step, text)).toBe(expected))
})

describe('nextStep', () => {
  it('asks the steps in order', () => {
    expect(INTERVIEW_STEPS).toEqual(['life', 'goal', 'why', 'has', 'failures', 'obstacles', 'minutes'])
    expect(nextStep({})).toEqual({ done: false, step: 'life', key: 'ai.iv.q.life' })
    expect(nextStep(undefined)).toMatchObject({ step: 'life' })
    expect(nextStep({ life: FULL.life })).toEqual({ done: false, step: 'goal', key: 'ai.iv.q.goal' })
  })

  it('asks to clarify a vague answer only once', () => {
    let a = applyAnswer({ life: FULL.life, goal: FULL.goal }, 'why', 'не знаю')
    expect(nextStep(a)).toEqual({ done: false, step: 'why', key: 'ai.iv.clarify.why', clarify: true })
    a = applyAnswer(a, 'why', 'хз')
    expect(a._clarified).toEqual({ why: true })
    expect(nextStep(a)).toEqual({ done: false, step: 'has', key: 'ai.iv.q.has' })
  })

  it('finishes with a summary and the classified sphere', () => {
    const result = nextStep(FULL, { domains: BUILTIN_DOMAINS })
    expect(result.done).toBe(true)
    expect(result.summary).toEqual({
      life: FULL.life, goal: FULL.goal, why: FULL.why, has: FULL.has,
      failures: FULL.failures, obstacles: FULL.obstacles, minutesPerDay: 40, sphere: 'health',
    })
  })

  it('falls back to universal without domains and when minutes stay vague', () => {
    const a = applyAnswer({ ...FULL, minutes: 'много' }, 'minutes', 'по-разному')
    const result = nextStep(a)
    expect(result.done).toBe(true)
    expect(result.summary).toMatchObject({ sphere: 'universal', minutesPerDay: 30 })
  })
})

describe('applyAnswer', () => {
  it('returns a new object and never mutates the input', () => {
    const before = { life: 'x y' }
    const frozen = JSON.stringify(before)
    const after = applyAnswer(before, 'goal', '  Run a marathon  ')
    expect(after).not.toBe(before)
    expect(after.goal).toBe('Run a marathon')
    expect(JSON.stringify(before)).toBe(frozen)
    expect(after._clarified).toBeUndefined()
  })

  it('ignores unknown steps and keeps the previous answer when the new one is empty', () => {
    expect(applyAnswer({ life: 'a b' }, 'nope', 'x')).toEqual({ life: 'a b' })
    expect(applyAnswer({ life: 'a b' }, 'life', '  ')).toMatchObject({ life: 'a b', _clarified: { life: true } })
  })
})
