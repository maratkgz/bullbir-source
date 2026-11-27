import { describe, it, expect } from 'vitest'
import { inferType, inferFreq, defaultMinutes, isCheckable, hasFrequency } from './itemTypes'

describe('inferType', () => {
  it.each([
    ['Бегать каждый день 20 минут', 'ru', 'habit'],
    ['Тренироваться 3 раза в неделю', 'ru', 'habit'],
    ['Звонить родителям раз в неделю', 'ru', 'habit'],
    ['Read 10 pages every day', 'en', 'habit'],
    ['Күн сайын 20 мүнөт окуу', 'kg', 'habit'],
    ['Жумасына 3 жолу машыгуу', 'kg', 'habit'],
    ['Сдать экзамен IELTS', 'ru', 'milestone'],
    ['Накопить 100 000 сом', 'ru', 'milestone'],
    ['Запустить сайт', 'ru', 'milestone'],
    ['Pass the driving test', 'en', 'milestone'],
    ['Save $1000 for a laptop', 'en', 'milestone'],
    ['Launch a podcast', 'en', 'milestone'],
    ['Экзаменди тапшыруу', 'kg', 'milestone'],
    ['Акча топтоо', 'kg', 'milestone'],
    ['Не сравнивать себя с другими', 'ru', 'quality'],
    ['Всегда держать слово', 'ru', 'quality'],
    ['Never skip breakfast', 'en', 'quality'],
    ['Always be on time', 'en', 'quality'],
    ['Эч качан кечикпөө', 'kg', 'quality'],
    ['Дайыма чынчыл болуу', 'kg', 'quality'],
    ['Медитация', 'ru', 'habit'],
    ['', 'ru', 'habit'],
  ])('“%s” (%s) → %s', (text, lang, type) => {
    expect(inferType(text, lang)).toBe(type)
  })

  it('frequency wins over a result verb', () => {
    expect(inferType('Откладывать и накопить по 1000 каждую неделю', 'ru')).toBe('habit')
  })
})

describe('inferFreq / hasFrequency', () => {
  it.each([
    ['Train 3 times a week', '3w'],
    ['Тренироваться три раза в неделю', '3w'],
    ['Жумасына 3 жолу машыгуу', '3w'],
    ['Звонить раз в неделю', 'weekly'],
    ['Review the budget every month', 'weekly'],
    ['Read every day', 'daily'],
    ['Медитировать', 'daily'],
  ])('%s → %s', (text, freq) => expect(inferFreq(text)).toBe(freq))

  it('detects frequency words', () => {
    expect(hasFrequency('ар күнү')).toBe(true)
    expect(hasFrequency('купить машину')).toBe(false)
  })
})

describe('defaultMinutes', () => {
  it('has a value per type and falls back to habit', () => {
    expect(defaultMinutes('habit')).toBe(20)
    expect(defaultMinutes('milestone')).toBe(60)
    expect(defaultMinutes('quality')).toBe(5)
    expect(defaultMinutes('?')).toBe(20)
  })
})

describe('isCheckable', () => {
  it.each([
    ['быть лучше', false],
    ['стать счастливее', false],
    ['be better', false],
    ['жакшы адам', false],
    ['', false],
    ['Пробежать 5 км', true],
    ['Читать каждый день', true],
    ['Finish the course by the end of May', true],
    ['Сдать экзамен', true],
    ['Күн сайын окуу', true],
    ['Read books', true],
  ])('“%s” → %s', (text, expected) => expect(isCheckable(text)).toBe(expected))
})
