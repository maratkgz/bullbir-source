import { describe, it, expect } from 'vitest'
import { buildLaunch, scheduleSteps, withLinkedIds, launchItems, dayBudget } from './launchPlan'
import { emptyMandala, normalizeMandala, DIRECTION_COLORS } from '../../components/modules/mandala/mandalaModel'

const TODAY = '2026-11-27'

/** Mandala with the given action cells: { 'd-a': cellPatch }. */
function makeMandala(cells, extra = {}) {
  const base = normalizeMandala({ ...emptyMandala('Big goal'), id: 'm1' })
  const directions = base.directions.map((dir, d) => ({
    ...dir,
    text: `Dir ${d}`,
    actions: dir.actions.map((a, i) => ({ ...a, ...(cells[`${d}-${i}`] || {}) })),
  }))
  return { ...base, directions, ...extra }
}

const sumByDay = (tasks) => tasks.reduce((m, t) => ({ ...m, [t.deadline]: (m[t.deadline] || 0) + t.minutes }), {})

describe('launchItems / dayBudget', () => {
  it('keeps open actions only and infers empty types', () => {
    const m = makeMandala({
      '0-0': { text: 'Read 10 pages every day' },
      '0-1': { text: 'Done thing', done: true, type: 'habit' },
      '0-2': { text: 'Pass the exam' },
      '0-3': { text: 'Never give up' },
    })
    expect(launchItems(m).map((i) => [i.a, i.type])).toEqual([[0, 'habit'], [2, 'milestone'], [3, 'quality']])
  })

  it('defaults timePerDay to 30', () => {
    expect(dayBudget({})).toBe(30)
    expect(dayBudget({ timePerDay: 45 })).toBe(45)
  })
})

describe('buildLaunch', () => {
  const m = makeMandala({
    '0-0': { text: 'Run 3 times a week', type: 'habit' },
    '1-4': { text: 'Meditate', type: 'habit', freq: 'weekly' },
    '2-0': { text: 'Pass the exam', type: 'milestone' },
    '3-1': { text: 'Always be kind', type: 'quality' },
  })

  it('splits items by type into habits, tasks and qualities', () => {
    const out = buildLaunch(m, { today: TODAY, lang: 'en' })
    expect(out.habits).toHaveLength(2)
    expect(out.habits[0]).toEqual({
      title: 'Run 3 times a week', emoji: '🎯', color: DIRECTION_COLORS[0], completions: [],
      freq: '3w', mandalaRef: { id: 'm1', d: 0, a: 0 },
    })
    expect(out.habits[1].freq).toBe('weekly')
    expect(out.qualities).toEqual([{ d: 3, a: 1, text: 'Always be kind' }])
    expect(out.tasks.length).toBeGreaterThanOrEqual(5)
    out.tasks.forEach((t, k) => {
      expect(t.mandalaRef).toEqual({ id: 'm1', d: 2, a: 0 })
      expect(t.step).toBe(k)
      expect(t.tags).toEqual(['mandala', 'Dir 2'])
      expect(t.description).toBe('Big goal → Dir 2')
      expect(t).toMatchObject({ status: 'todo', timeGroup: 'day', subtasks: [] })
      expect(t.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
    expect(out.tasks[0].deadline).toBe(TODAY)
    expect(out.tasks[0].priority).toBe('high')
    expect(out.skipped).toBe(0)
  })

  it('puts at most one step of a milestone on each day, in order', () => {
    const { tasks, days } = buildLaunch(m, { today: TODAY, lang: 'en' })
    const dates = tasks.map((t) => t.deadline)
    expect(new Set(dates).size).toBe(dates.length)
    expect([...dates].sort()).toEqual(dates)
    expect(days).toBeGreaterThanOrEqual(tasks.length)
  })

  it('keeps the daily sum of minutes under timePerDay across milestones', () => {
    const two = makeMandala({
      '0-0': { text: 'Pass the exam', type: 'milestone' },
      '1-0': { text: 'Save money for a car', type: 'milestone' },
      '2-0': { text: 'Launch a website', type: 'milestone' },
    }, { timePerDay: 40 })
    const { tasks } = buildLaunch(two, { today: TODAY, lang: 'ru' })
    expect(tasks.every((t) => t.minutes <= 40)).toBe(true)
    Object.values(sumByDay(tasks)).forEach((sum) => expect(sum).toBeLessThanOrEqual(40))
    const perMilestoneDay = tasks.map((t) => `${t.mandalaRef.d}-${t.deadline}`)
    expect(new Set(perMilestoneDay).size).toBe(tasks.length)
  })

  it('skips habits and steps that were already launched', () => {
    const first = buildLaunch(m, { today: TODAY, lang: 'en' })
    const existingTasks = first.tasks.slice(0, 2)
    const existingHabits = [first.habits[0], { ...first.habits[1], mandalaRef: { id: 'other', d: 1, a: 4 } }]
    const again = buildLaunch(m, { today: TODAY, lang: 'en', existingTasks, existingHabits })
    expect(again.habits.map((h) => h.mandalaRef)).toEqual([{ id: 'm1', d: 1, a: 4 }])
    expect(again.tasks.map((t) => t.step)).toEqual(first.tasks.slice(2).map((t) => t.step))
    expect(again.skipped).toBe(3)
  })

  it('is deterministic and does not mutate the mandala', () => {
    const snapshot = JSON.stringify(m)
    expect(buildLaunch(m, { today: TODAY })).toEqual(buildLaunch(m, { today: TODAY }))
    expect(JSON.stringify(m)).toBe(snapshot)
  })

  it('returns an empty launch for an empty mandala', () => {
    expect(buildLaunch(makeMandala({}), { today: TODAY })).toEqual({ habits: [], tasks: [], qualities: [], skipped: 0, days: 0 })
  })
})

describe('scheduleSteps', () => {
  const q = (d, mins) => ({ d, a: 0, queue: mins.map((minutes, step) => ({ title: `s${step}`, minutes, step })) })

  it('pushes steps to later days when the day is full', () => {
    const placed = scheduleSteps([q(0, [20, 20]), q(1, [20, 20])], 30)
    expect(placed.map((p) => [p.item.d, p.day])).toEqual([[0, 0], [1, 1], [0, 2], [1, 3]])
  })

  it('shares a day between milestones when minutes allow', () => {
    const placed = scheduleSteps([q(0, [10, 10]), q(1, [10, 10])], 30)
    expect(placed.map((p) => [p.item.d, p.day])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]])
  })
})

describe('withLinkedIds', () => {
  it('appends ids to cells immutably without duplicates', () => {
    const m = makeMandala({ '0-0': { text: 'x', linkedIds: ['a'] } })
    const dirs = withLinkedIds(m, [{ d: 0, a: 0, id: 'a' }, { d: 0, a: 0, id: 'b' }, { d: 5, a: 7, id: 'c' }])
    expect(dirs[0].actions[0].linkedIds).toEqual(['a', 'b'])
    expect(dirs[5].actions[7].linkedIds).toEqual(['c'])
    expect(m.directions[0].actions[0].linkedIds).toEqual(['a'])
    expect(dirs[1]).toEqual(m.directions[1])
  })
})
