import { describe, it, expect } from 'vitest'
import { emptyMandala } from '../../components/modules/mandala/mandalaModel'
import {
  WEEK_PLAN, pickActiveMandala, toggleCheck, isoWeekId, reviewSunday, reviewWeekId, planStartDate,
  nextSundayKey, shouldShowReviewBanner, directionStats, buildWeekPlan, planTaskOps, buildReviewDoc,
  hasReviewReminder, todayFromSearch, normalizeChecks,
} from './weekPlan'
import { toDateKey } from './dates'

const day = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 10) }

function mandalaWith(fill) {
  const base = { ...emptyMandala('Goal'), id: 'm1' }
  return {
    ...base,
    directions: base.directions.map((dir, d) => ({
      ...dir,
      text: fill[d] ? `Dir ${d}` : '',
      actions: dir.actions.map((a, i) => (i < (fill[d] || 0) ? { ...a, text: `A${d}.${i}` } : a)),
    })),
  }
}

describe('pickActiveMandala', () => {
  it('returns the most recently updated active mandala with extras', () => {
    const docs = [
      { id: 'a', status: 'active', updatedAt: { seconds: 10 }, timePerDay: 45, checks: { '2026-11-27': ['0-1', 'bad'] } },
      { id: 'b', status: 'active', updatedAt: { seconds: 20 } },
      { id: 'c', status: 'draft', updatedAt: { seconds: 30 } },
    ]
    const m = pickActiveMandala(docs)
    expect(m.id).toBe('b')
    expect(m.timePerDay).toBe(0)
    expect(pickActiveMandala([docs[0]]).checks).toEqual({ '2026-11-27': ['0-1'] })
    expect(pickActiveMandala([docs[0]]).timePerDay).toBe(45)
  })

  it('returns null without an active mandala', () => {
    expect(pickActiveMandala([{ id: 'x', status: 'archived' }])).toBeNull()
    expect(pickActiveMandala()).toBeNull()
  })
})

describe('checks', () => {
  it('toggles a key without mutating and prunes days older than 14', () => {
    const checks = { '2026-11-01': ['0-0'], '2026-11-20': ['1-1'] }
    const next = toggleCheck(checks, '2026-11-27', '2-3')
    expect(next).toEqual({ '2026-11-20': ['1-1'], '2026-11-27': ['2-3'] })
    expect(checks['2026-11-01']).toEqual(['0-0'])
    expect(toggleCheck(next, '2026-11-27', '2-3')['2026-11-27']).toEqual([])
  })

  it('normalizes garbage', () => {
    expect(normalizeChecks(null)).toEqual({})
    expect(normalizeChecks({ nope: ['0-0'], '2026-01-01': 'x' })).toEqual({})
  })
})

describe('weeks', () => {
  it('computes ISO week ids, including year boundaries', () => {
    expect(isoWeekId(day('2026-11-29'))).toBe('2026-W48')
    expect(isoWeekId(day('2026-11-30'))).toBe('2026-W49')
    expect(isoWeekId(day('2021-01-03'))).toBe('2020-W53')
    expect(isoWeekId(day('2024-12-30'))).toBe('2025-W01')
  })

  it('picks the reviewed Sunday and the plan start', () => {
    expect(toDateKey(reviewSunday(day('2026-11-29')))).toBe('2026-11-29') // Sunday
    expect(toDateKey(reviewSunday(day('2026-11-30')))).toBe('2026-11-29') // Monday
    expect(toDateKey(reviewSunday(day('2026-11-27')))).toBe('2026-11-29') // Friday
    expect(reviewWeekId(day('2026-11-30'))).toBe('2026-W48')
    expect(toDateKey(planStartDate(day('2026-11-29')))).toBe('2026-11-30')
  })

  it('finds the next Sunday strictly after today', () => {
    expect(nextSundayKey(day('2026-11-29'))).toBe('2026-12-06')
    expect(nextSundayKey(day('2026-11-30'))).toBe('2026-12-06')
    expect(nextSundayKey(day('2026-11-28'))).toBe('2026-11-29')
  })

  it('shows the banner on Sunday/Monday until confirmed', () => {
    expect(shouldShowReviewBanner(day('2026-11-29'), null)).toBe(true)
    expect(shouldShowReviewBanner(day('2026-11-30'), { confirmed: false })).toBe(true)
    expect(shouldShowReviewBanner(day('2026-11-30'), { confirmed: true })).toBe(false)
    expect(shouldShowReviewBanner(day('2026-11-27'), null)).toBe(false)
  })
})

describe('directionStats', () => {
  it('lists filled directions with done/total', () => {
    const m = mandalaWith({ 0: 2, 3: 1 })
    const done = { ...m, directions: m.directions.map((d, i) => (i === 0 ? { ...d, actions: d.actions.map((a, k) => (k === 0 ? { ...a, done: true } : a)) } : d)) }
    expect(directionStats(done)).toEqual([
      { d: 0, title: 'Dir 0', pct: 50, done: 1, total: 2 },
      { d: 3, title: 'Dir 3', pct: 0, done: 0, total: 1 },
    ])
    expect(directionStats(null)).toEqual([])
  })
})

describe('buildWeekPlan', () => {
  const m = mandalaWith({ 0: 4, 1: 4, 2: 4 })

  it('fills 7 days with 3 tasks, lagging direction gets double share', () => {
    const plan = buildWeekPlan({ mandala: m, lagging: ['m1:2'], startDate: '2026-11-30' })
    expect(plan).toHaveLength(WEEK_PLAN.days)
    expect(plan[0].date).toBe('2026-11-30')
    expect(plan[6].date).toBe('2026-12-06')
    expect(plan[0].items.map((x) => x.d)).toEqual([2, 2, 0])
    expect(plan.flatMap((p) => p.items)).toHaveLength(12)
  })

  it('uses 2 per day when easing and skips qualities and done actions', () => {
    const mixed = {
      ...m,
      directions: m.directions.map((dir, d) => (d === 0
        ? { ...dir, actions: dir.actions.map((a, i) => (i === 0 ? { ...a, type: 'quality' } : i === 1 ? { ...a, done: true } : a)) }
        : dir)),
    }
    const plan = buildWeekPlan({ mandala: mixed, ease: true, startDate: '2026-11-30' })
    expect(plan[0].items).toHaveLength(2)
    const refs = plan.flatMap((p) => p.items).map((x) => `${x.d}-${x.a}`)
    expect(refs).not.toContain('0-0')
    expect(refs).not.toContain('0-1')
  })

  it('reuses existing open tasks and returns empty days without a mandala', () => {
    const tasks = [{ id: 't1', status: 'todo', mandalaRef: { id: 'm1', d: 0, a: 3 } }]
    const plan = buildWeekPlan({ mandala: m, tasks, startDate: '2026-11-30' })
    expect(plan[0].items[0]).toMatchObject({ d: 0, a: 3, taskId: 't1' })
    expect(buildWeekPlan({ mandala: null, startDate: '2026-11-30' }).every((p) => p.items.length === 0)).toBe(true)
  })
})

describe('planTaskOps', () => {
  it('creates new tasks and only re-dates existing open ones', () => {
    const m = mandalaWith({ 0: 2 })
    const tasks = [
      { id: 't1', status: 'todo', mandalaRef: { id: 'm1', d: 0, a: 1 } },
      { id: 't0', status: 'done', mandalaRef: { id: 'm1', d: 0, a: 0 } },
    ]
    const plan = [{ date: '2026-11-30', items: [{ d: 0, a: 0, title: 'A0.0' }, { d: 0, a: 1, title: 'A0.1' }] }]
    const ops = planTaskOps(plan, m, tasks)
    expect(ops.updates).toEqual([{ id: 't1', patch: { deadline: '2026-11-30' } }])
    expect(ops.creates).toHaveLength(1)
    expect(ops.creates[0]).toMatchObject({
      title: 'A0.0', deadline: '2026-11-30', status: 'todo', priority: 'high', description: 'Goal → Dir 0',
      mandalaRef: { id: 'm1', d: 0, a: 0 },
    })
  })
})

describe('buildReviewDoc', () => {
  it('maps engine output to the weeklyReviews shape', () => {
    const m = mandalaWith({ 0: 1 })
    const review = { summary: { key: 'ai.week.summary', vars: { done: 2, planned: 4, pct: 50 } }, lagging: ['m1:0', 'x:1'] }
    const doc = buildReviewDoc({ weekId: '2026-W48', mandala: m, review, summaryText: 'ok', plan: [{ date: '2026-11-30', items: [{ title: 'A' }] }] })
    expect(doc).toMatchObject({
      weekId: '2026-W48', mandalaId: 'm1', summary: 'ok', lagging: [0], confirmed: true,
      stats: { tasksDone: 2, tasksPlanned: 4, completionPct: 50 },
      plan: [{ date: '2026-11-30', titles: ['A'] }],
    })
    const empty = buildReviewDoc({ weekId: 'w', mandala: m, review: { summary: { key: 'ai.week.summary.empty', vars: {} }, lagging: [] }, summaryText: '', plan: [] })
    expect(empty.stats.completionPct).toBe(0)
  })
})

describe('misc', () => {
  it('detects an existing review reminder', () => {
    const list = [{ title: 'Weekly review', date: '2026-12-06', done: false }]
    expect(hasReviewReminder(list, '2026-12-06', ['Weekly review'])).toBe(true)
    expect(hasReviewReminder(list, '2026-12-13', ['Weekly review'])).toBe(false)
  })

  it('reads the dev ?today= override only when enabled', () => {
    expect(toDateKey(todayFromSearch('?today=2026-11-29', true))).toBe('2026-11-29')
    expect(toDateKey(todayFromSearch('?today=2026-11-29', false))).toBe(toDateKey(new Date()))
    expect(toDateKey(todayFromSearch('?today=bad', true))).toBe(toDateKey(new Date()))
  })
})
