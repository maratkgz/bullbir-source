import { describe, it, expect } from 'vitest'
import { mandalaFromDomain } from './mandalaGenerator'
import { planTasks } from './planner'
import { weeklyReview } from './insights'
import { answer } from './coach'
import { emptyMandala } from '../../components/modules/mandala/mandalaModel'

const L = (s) => ({ en: `${s} en`, kg: `${s} kg`, ru: `${s} ru` })
const DOMAIN = {
  id: 'health',
  icon: '💪',
  title: L('Health'),
  keywords: { en: ['health'], kg: ['ден'], ru: ['здоровье'] },
  directions: Array.from({ length: 8 }, (_, d) => ({
    title: L(`Dir ${d}`),
    milestones: [L(`Ms ${d}`)],
    actions: Array.from({ length: 8 }, (__, a) => L(`Act ${d}.${a}`)),
  })),
}

describe('mandalaFromDomain', () => {
  it('fills every direction and action in the chosen language', () => {
    const m = mandalaFromDomain(DOMAIN, 'Марафон', 'ru')
    expect(m.title).toBe('Марафон')
    expect(m.directions[2].text).toBe('Dir 2 ru')
    expect(m.directions[2].actions[5].text).toBe('Act 2.5 ru')
    expect(m.directions[0].milestones[0]).toMatchObject({ text: 'Ms 0 ru', done: false })
  })

  it('never overwrites what the user already wrote', () => {
    const existing = emptyMandala('Goal')
    const mine = {
      ...existing,
      directions: existing.directions.map((d, i) => (i === 0
        ? { ...d, text: 'My dir', actions: d.actions.map((a, j) => (j === 0 ? { ...a, text: 'My act', done: true } : a)) }
        : d)),
    }
    const m = mandalaFromDomain(DOMAIN, 'Goal', 'en', { existing: mine })
    expect(m.directions[0].text).toBe('My dir')
    expect(m.directions[0].actions[0]).toMatchObject({ text: 'My act', done: true })
    expect(m.directions[0].actions[1].text).toBe('Act 0.1 en')
    expect(mine.directions[0].actions[1].text).toBe('') // input not mutated
  })
})

describe('planTasks', () => {
  const mandala = { id: 'm1', ...mandalaFromDomain(DOMAIN, 'Goal', 'en') }

  it('spreads actions over weeks with end-of-week deadlines', () => {
    const tasks = planTasks(mandala, { startDate: '2026-01-05', weeks: 2, perWeek: 3 })
    expect(tasks).toHaveLength(6)
    expect(tasks.slice(0, 3).every((t) => t.deadline === '2026-01-11')).toBe(true)
    expect(tasks.slice(3).every((t) => t.deadline === '2026-01-18')).toBe(true)
    expect(tasks[0]).toMatchObject({ status: 'todo', mandalaRef: { id: 'm1' } })
  })

  it('rotates across directions instead of exhausting one', () => {
    const tasks = planTasks(mandala, { startDate: '2026-01-05', weeks: 1, perWeek: 8 })
    const dirs = new Set(tasks.map((t) => t.mandalaRef.d))
    expect(dirs.size).toBe(8)
  })

  it('skips done actions and actions that already have a task', () => {
    const done = {
      ...mandala,
      directions: mandala.directions.map((d) => ({ ...d, actions: d.actions.map((a, j) => ({ ...a, done: j > 0 })) })),
    }
    const existingTasks = [{ mandalaRef: { id: 'm1', d: 0, a: 0 } }]
    const tasks = planTasks(done, { startDate: '2026-01-05', weeks: 4, perWeek: 10, existingTasks })
    expect(tasks).toHaveLength(7)
    expect(tasks.some((t) => t.mandalaRef.d === 0)).toBe(false)
  })
})

describe('weeklyReview', () => {
  const today = new Date('2026-01-14T12:00:00')
  it('computes task, habit and mood stats for the last 7 days', () => {
    const review = weeklyReview({
      tasks: [
        { status: 'done', completedAt: new Date('2026-01-12T10:00:00') },
        { status: 'todo', deadline: '2026-01-10' },
        { status: 'todo', deadline: '2026-01-20' },
      ],
      habits: [{ completions: ['2026-01-13', '2026-01-12', '2025-12-01'] }],
      moods: [{ date: '2026-01-13', value: 4 }, { date: '2026-01-09', value: 2 }],
      mandalas: [],
    }, today)
    expect(review.stats.tasksDone).toBe(1)
    expect(review.stats.tasksOverdue).toBe(1)
    expect(review.stats.habitCheckins).toBe(2)
    expect(review.stats.moodAvg).toBe(3)
    expect(review.insights.some((i) => i.kind === 'overdue')).toBe(true)
  })

  it('handles a completely empty account', () => {
    const review = weeklyReview({ tasks: [], habits: [], moods: [], mandalas: [] }, today)
    expect(review.stats.tasksDone).toBe(0)
    expect(review.insights[0].kind).toBe('next')
  })
})

describe('answer (coach)', () => {
  const intents = [
    { id: 'motivation', patterns: { en: ['no motivation'], kg: ['мотивация жок'], ru: ['нет мотивации'] }, answers: { en: ['Start small.'], kg: ['Кичинеден баштаңыз.'], ru: ['Начните с малого.'] } },
    { id: 'progress', insight: 'progress', patterns: { en: ['how am I doing'], kg: ['ийгилигим кандай'], ru: ['как мой прогресс'] }, answers: { en: ['Here is your progress:'], kg: ['Сиздин ийгилик:'], ru: ['Ваш прогресс:'] } },
    { id: 'fallback', patterns: { en: ['-'], kg: ['-'], ru: ['-'] }, answers: { en: ['Try rephrasing.'], kg: ['Башкача жазып көрүңүз.'], ru: ['Попробуйте переформулировать.'] } },
  ]

  it('matches an intent in the user language', () => {
    expect(answer('У меня совсем нет мотивации', intents, { lang: 'ru' }).text).toBe('Начните с малого.')
  })

  it('appends live data for insight intents', () => {
    const res = answer('как там мой прогресс?', intents, { lang: 'ru', describeInsight: () => '12 из 36 действий' })
    expect(res.intentId).toBe('progress')
    expect(res.text).toContain('12 из 36 действий')
  })

  it('falls back when nothing matches', () => {
    expect(answer('квантовая физика', intents, { lang: 'ru' }).intentId).toBe('fallback')
  })
})
