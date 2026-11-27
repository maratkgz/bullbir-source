import { describe, it, expect } from 'vitest'
import { todayPlan } from './today'
import { normalizeMandala } from '../../components/modules/mandala/mandalaModel'

// Direction d has 4 actions; `doneCount[d]` of them done → progress 0/25/50/…
function mandala(id, doneCount, patch = () => ({})) {
  return {
    ...normalizeMandala({
      title: id,
      directions: Array.from({ length: 8 }, (_, d) => ({
        text: `Dir ${d}`,
        actions: Array.from({ length: 4 }, (__, a) => ({ text: `A${d}.${a}`, done: a < (doneCount[d] || 0), minutes: 10, ...patch(d, a) })),
      })),
    }),
    id,
  }
}
const task = (id, d, a, extra = {}) => ({ id, status: 'todo', mandalaRef: { id: 'm1', d, a }, ...extra })
const TODAY = new Date('2026-03-10T09:00:00')

describe('todayPlan', () => {
  const m = mandala('m1', [4, 2, 0, 1])

  it('picks up to 3 tasks from different directions, lagging first', () => {
    const tasks = [task('t1', 0, 0), task('t2', 1, 3), task('t3', 2, 1), task('t4', 2, 2), task('t5', 3, 2), task('t6', 4, 0)]
    const plan = todayPlan({ mandalas: [m], tasks, minutesPerDay: 60, today: TODAY })
    expect(plan.tasks.map((t) => t.taskId)).toEqual(['t3', 't6', 't5'])
    expect(new Set(plan.tasks.map((t) => t.directionId)).size).toBe(3)
    expect(plan.tasks[0]).toEqual({
      taskId: 't3', directionId: 'm1:2', mandalaId: 'm1', minutes: 10, why: { key: 'ai.today.why.lagging', vars: { direction: 'Dir 2' } },
    })
    expect(plan.minutesTotal).toBe(30)
  })

  it('puts overdue tasks first within a direction and explains why', () => {
    const tasks = [task('a', 2, 1, { deadline: '2026-03-20' }), task('b', 2, 2, { deadline: '2026-03-01' })]
    const plan = todayPlan({ mandalas: [m], tasks, minutesPerDay: 60, today: TODAY })
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]).toMatchObject({ taskId: 'b', why: { key: 'ai.today.why.overdue' } })
  })

  it('respects the time budget and returns fewer tasks when they do not fit', () => {
    const big = mandala('m1', [0, 0, 0], (d) => ({ minutes: d === 0 ? 50 : 20 }))
    const tasks = [task('x', 0, 0), task('y', 1, 0), task('z', 2, 0)]
    const plan = todayPlan({ mandalas: [big], tasks, minutesPerDay: 45, today: TODAY })
    expect(plan.tasks.map((t) => t.taskId)).toEqual(['y', 'z'])
    expect(plan.minutesTotal).toBe(40)
  })

  it('uses default minutes when the cell has none and labels advanced directions "next"', () => {
    const plain = mandala('m1', [3], () => ({ minutes: 0, type: 'milestone' }))
    const plan = todayPlan({ mandalas: [plain], tasks: [task('t', 0, 3)], minutesPerDay: 120, today: TODAY })
    expect(plan.tasks[0]).toMatchObject({ minutes: 60, why: { key: 'ai.today.why.next', vars: { direction: 'Dir 0' } } })
  })

  it('ignores done tasks, unlinked tasks and broken refs', () => {
    const tasks = [task('d', 2, 0, { status: 'done' }), { id: 'free', status: 'todo' }, task('bad', 7, 9), null]
    const plan = todayPlan({ mandalas: [m], tasks, minutesPerDay: 60, today: TODAY })
    expect(plan.tasks).toEqual([])
    expect(plan.minutesTotal).toBe(0)
  })

  it('lists quality cells (max 5) and works with empty input', () => {
    const q = mandala('m1', [], (d, a) => (a < 2 ? { type: 'quality' } : {}))
    const plan = todayPlan({ mandalas: [q], tasks: [], today: TODAY })
    expect(plan.qualities).toHaveLength(5)
    expect(plan.qualities[0]).toEqual({ mandalaId: 'm1', d: 0, i: 0, text: 'A0.0' })
    expect(todayPlan()).toEqual({ tasks: [], qualities: [], minutesTotal: 0 })
  })

  it('does not mutate its inputs', () => {
    const tasks = [task('t3', 2, 1)]
    const before = JSON.stringify({ m, tasks })
    todayPlan({ mandalas: [m], tasks, minutesPerDay: 30, today: TODAY })
    expect(JSON.stringify({ m, tasks })).toBe(before)
  })
})
