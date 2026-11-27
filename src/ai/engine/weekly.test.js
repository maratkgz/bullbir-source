import { describe, it, expect } from 'vitest'
import { weeklyCoachReview, habitStreak } from './weekly'
import { normalizeMandala } from '../../components/modules/mandala/mandalaModel'

const TODAY = new Date('2026-03-10T12:00:00')
const mandala = normalizeMandala({
  title: 'Goal',
  directions: [
    { text: 'Run', actions: [{ text: 'a', done: true, doneAt: '2026-03-08' }, { text: 'b', done: true, doneAt: '2026-03-09' }, { text: 'c' }] },
    { text: 'Food', actions: [{ text: 'd', done: true, doneAt: '2026-03-05' }, { text: 'e' }, { text: 'f' }, { text: 'g' }] },
    { text: 'Sleep', actions: [{ text: 'h' }, { text: 'i' }] },
  ],
})
const M = { ...mandala, id: 'm1' }
const ref = (d, a) => ({ mandalaRef: { id: 'm1', d, a } })
const done = (id, day, extra = {}) => ({ id, status: 'done', completedAt: new Date(`${day}T10:00:00`), deadline: day, ...extra })
const todo = (id, deadline, extra = {}) => ({ id, status: 'todo', deadline, ...extra })

describe('habitStreak', () => {
  it('counts consecutive days ending today or yesterday', () => {
    expect(habitStreak(['2026-03-10', '2026-03-09', '2026-03-08', '2026-03-06'], TODAY)).toBe(3)
    expect(habitStreak(['2026-03-09', '2026-03-08'], TODAY)).toBe(2)
    expect(habitStreak(['2026-03-07'], TODAY)).toBe(0)
    expect(habitStreak(undefined, TODAY)).toBe(0)
  })
})

describe('weeklyCoachReview', () => {
  it('lists concrete wins first, lagging directions and a summary', () => {
    const tasks = [done('t1', '2026-03-08'), done('t2', '2026-03-09'), done('t3', '2026-03-10'), todo('t4', '2026-03-11')]
    const habits = [{ title: 'Water', completions: ['2026-03-10', '2026-03-09', '2026-03-08', '2026-03-07'] }]
    const r = weeklyCoachReview({ tasks, habits, mandalas: [M] }, TODAY)
    expect(r.wins).toEqual([
      { key: 'ai.week.win.direction', vars: { direction: 'Run', n: 2 } },
      { key: 'ai.week.win.streak', vars: { habit: 'Water', days: 4 } },
      { key: 'ai.week.win.tasks', vars: { n: 3 } },
    ])
    expect(r.summary).toEqual({ key: 'ai.week.summary', vars: { done: 3, planned: 3, pct: 100 } })
    expect(r.lagging).toEqual(['m1:2', 'm1:1'])
    expect(r.advice).toEqual({ key: 'ai.week.advice.lagging', vars: { direction: 'Sleep' } })
    expect(r.ease).toBe(false)
  })

  it('eases the plan when less than 40% was completed: 2 tasks a day', () => {
    const tasks = [
      done('d1', '2026-03-09'),
      ...['2026-03-04', '2026-03-05', '2026-03-06'].map((day, k) => todo(`late${k}`, day)),
      ...Array.from({ length: 12 }, (_, k) => todo(`n${k}`, '2026-03-20')),
    ]
    const r = weeklyCoachReview({ tasks, habits: [], mandalas: [] }, TODAY)
    expect(r.ease).toBe(true)
    expect(r.advice).toEqual({ key: 'ai.week.advice.ease', vars: {} })
    expect(r.summary.vars).toEqual({ done: 1, planned: 4, pct: 25 })
    expect(r.nextWeek).toHaveLength(7)
    expect(r.nextWeek[0]).toEqual({ day: 1, taskIds: ['late0', 'late1'] })
    expect(r.nextWeek.every((d) => d.taskIds.length <= 2)).toBe(true)
    expect(r.nextWeek.flatMap((d) => d.taskIds)).toHaveLength(14)
  })

  it('plans 3 tasks a day, lagging directions first and interleaved', () => {
    const tasks = [
      todo('run1', '2026-03-12', ref(0, 2)),
      todo('food1', '2026-03-12', ref(1, 1)), todo('food2', '2026-03-13', ref(1, 2)),
      todo('sleep1', '2026-03-12', ref(2, 0)), todo('sleep2', '2026-03-12', ref(2, 1)),
      done('x', '2026-03-09'),
    ]
    const r = weeklyCoachReview({ tasks, mandalas: [M] }, TODAY)
    expect(r.ease).toBe(false)
    expect(r.nextWeek[0].taskIds).toEqual(['sleep1', 'food1', 'run1'])
    expect(r.nextWeek[1].taskIds).toEqual(['sleep2', 'food2'])
    expect(r.nextWeek[2].taskIds).toEqual([])
  })

  it('handles an empty week', () => {
    const r = weeklyCoachReview({}, TODAY)
    expect(r).toEqual({
      summary: { key: 'ai.week.summary.empty', vars: {} },
      wins: [],
      lagging: [],
      advice: { key: 'ai.week.advice.steady', vars: {} },
      nextWeek: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, taskIds: [] })),
      ease: false,
    })
  })

  it('says "keep going" on a strong week and does not mutate input', () => {
    const tasks = [done('a', '2026-03-09'), done('b', '2026-03-08')]
    const before = JSON.stringify(tasks)
    const r = weeklyCoachReview({ tasks, mandalas: [] }, TODAY)
    expect(r.advice.key).toBe('ai.week.advice.keep')
    expect(JSON.stringify(tasks)).toBe(before)
  })
})
