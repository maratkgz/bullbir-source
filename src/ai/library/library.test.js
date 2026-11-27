import { describe, it, expect } from 'vitest'
import { BUILTIN_DOMAINS, BUILTIN_INTENTS } from './index'
import { validateDomain, validateIntent } from './schema'
import { classifyGoal } from '../engine/classifier'
import { answer } from '../engine/coach'

// Guards the content team: a broken library file fails `npm test` before it ships.
describe('built-in library', () => {
  it.each(BUILTIN_DOMAINS.map((d) => [d.id, d]))('domain %s is valid', (_id, domain) => {
    expect(validateDomain(domain)).toEqual([])
  })

  it.each(BUILTIN_INTENTS.map((i) => [i.id, i]))('coach intent %s is valid', (_id, intent) => {
    expect(validateIntent(intent)).toEqual([])
  })

  it('has unique ids and a universal + fallback entry', () => {
    const ids = BUILTIN_DOMAINS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('universal')
    expect(BUILTIN_INTENTS.map((i) => i.id)).toContain('fallback')
  })

  it('uses real Kyrgyz letters, not Latin look-alikes inside Cyrillic words', () => {
    const kg = JSON.stringify(BUILTIN_DOMAINS.map((d) => d.directions.map((x) => [x.title.kg, x.actions.map((a) => a.kg)])))
    // e.g. "Кыргызстaн" with a Latin "a" inside a Cyrillic word. Kyrgyz suffixes on Latin
    // names ("GitHubдан", "SQLди") and acronyms ("IT", "CEFR") are correct and allowed.
    expect(kg).not.toMatch(/[а-яёңүө][a-z]+[а-яёңүө]/iu)
    expect(kg).toMatch(/[ңүө]/)
  })

  it.each([
    ['Пробежать марафон к октябрю', 'health'],
    ['Похудеть на 10 кг', 'health'],
    ['Накопить на квартиру', 'finance'],
    ['Выучить английский до уровня B2', 'languages'],
    ['Хочу стать программистом с нуля', 'programming'],
    ['Become a frontend developer', 'programming'],
    ['Программист болуу', 'programming'],
    ['Выучить арабский язык', 'arabic'],
    ['Научиться читать Коран', 'arabic'],
    ['Араб тилин үйрөнүү', 'arabic'],
    ['Стать преподавателем арабского языка', 'language-teacher'],
    ['Стать учителем английского', 'language-teacher'],
    ['Англис тилинин мугалими болуу', 'language-teacher'],
    ['Become an English teacher', 'language-teacher'],
    ['Сдать IELTS на 7 баллов', 'languages'],
    ['Поступить в университет', 'learning'],
    ['Получить повышение до руководителя', 'career'],
    ['Run a marathon', 'health'],
    ['Save money for a car', 'finance'],
    ['Англис тилин үйрөнүү', 'languages'],
    ['Бизнес ачуу', 'business'],
    ['Ден соолугумду чыңдоо', 'health'],
    ['Научиться медитировать', 'mental'],
    ['Переехать жить к морю', 'relocation'],
  ])('classifies “%s” as %s', (goal, expected) => {
    expect(classifyGoal(goal, BUILTIN_DOMAINS)[0].id).toBe(expected)
  })

  it.each([
    ['ru', 'нет мотивации совсем', 'motivation'],
    ['kg', 'мотивация жок', 'motivation'],
    ['en', 'I keep procrastinating', 'procrastination'],
    ['ru', 'что делать дальше?', 'focus'],
    ['ru', 'как работает мандала', 'how-mandala'],
    ['ru', 'Хочу стать программистом, не знаю с чего начать', 'new-goal'],
    ['kg', 'Программист болгум келет', 'new-goal'],
    ['ru', 'Я постоянно откладываю дела', 'procrastination'],
    ['ru', 'успеваю ли я к сроку?', 'pace'],
    ['ru', 'какие у меня награды', 'rewards'],
  ])('coach (%s) understands “%s”', (lang, msg, intent) => {
    expect(answer(msg, BUILTIN_INTENTS, { lang }).intentId).toBe(intent)
  })
})
