import { describe, it, expect } from 'vitest'
import { checkSafety, compileLexicon, stopsPlanning, STOPS_PLANNING, SAFETY_LEVELS } from './safety'
import lexicon from '../library/safety.json'
import { LANGS } from '../library/schema'

describe('safety lexicon', () => {
  it('has every level in every language', () => {
    SAFETY_LEVELS.filter((l) => l !== 'ok').forEach((level) => {
      LANGS.forEach((l) => expect(lexicon.levels[level][l].length).toBeGreaterThan(0))
    })
  })
})

describe('checkSafety', () => {
  it.each([
    ['Я хочу умереть', 'crisis'],
    ['иногда думаю покончить с собой', 'crisis'],
    ['Мне кажется, жить не хочу', 'crisis'],
    ['I want to kill myself', 'crisis'],
    ['thinking about suicide lately', 'crisis'],
    ['Өлгүм келет', 'crisis'],
    ['Жашагым келбейт', 'crisis'],
    ['Муж меня бьёт каждый день', 'violence'],
    ['My partner hits me', 'violence'],
    ['Үйдө зомбулук көп', 'violence'],
    ['Хочу взломать аккаунт бывшей', 'illegal'],
    ['Купить поддельный паспорт', 'illegal'],
    ['How to sell drugs', 'illegal'],
    ['Баңгизат сатуу', 'illegal'],
    ['Какая дозировка таблеток для похудения', 'health'],
    ['Голодание 10 дней чтобы похудеть', 'health'],
    ['Which pills help to lose weight', 'health'],
    ['Кандай дары ичүү керек', 'health'],
    ['Вложить всё в крипту', 'money'],
    ['Взять кредит на машину', 'money'],
    ['Микрозайм на бизнес', 'money'],
    ['Buy bitcoin with all my savings', 'money'],
    ['Насыя алып үй сатып алуу', 'money'],
  ])('“%s” → %s', (text, level) => {
    expect(checkSafety(text)).toEqual({ level, key: `ai.safety.${level}` })
  })

  it.each([
    'Хочу умереть со смеху от этого фильма',
    'Мы умираем со смеху',
    'This show made me die laughing',
    "I'm dying to start running",
    'Нужно убить время в дороге',
    'Займусь спортом с понедельника',
    'Пробежать марафон к октябрю',
    'Накопить на квартиру без долгов',
    'Read every day',
    'Methodical study plan',
    'I will not forget to train',
    'Становиться сильнее',
    'Англис тилин үйрөнүү',
    '',
  ])('“%s” is ok', (text) => {
    expect(checkSafety(text)).toEqual({ level: 'ok', key: null })
  })

  it('applies priority crisis > violence > illegal > health > money', () => {
    expect(checkSafety('Взял кредит, меня бьют, хочу умереть').level).toBe('crisis')
    expect(checkSafety('Меня бьют из-за кредита').level).toBe('violence')
    expect(checkSafety('Кредит на наркотики').level).toBe('illegal')
    expect(checkSafety('Кредит на таблетки').level).toBe('health')
  })

  it('still catches a real crisis phrase next to an excluded idiom', () => {
    expect(checkSafety('Умираю со смеху, но на самом деле хочу умереть').level).toBe('crisis')
  })

  it('stops planning only for crisis and violence', () => {
    expect(STOPS_PLANNING).toEqual(['crisis', 'violence'])
    expect(stopsPlanning('crisis')).toBe(true)
    expect(stopsPlanning('money')).toBe(false)
  })

  it('accepts a custom compiled lexicon', () => {
    const custom = compileLexicon({ exclusions: {}, levels: { money: { en: ['lottery*'] } } })
    expect(checkSafety('Win the lottery', custom).level).toBe('money')
    expect(checkSafety('kill myself', custom).level).toBe('ok')
  })
})
