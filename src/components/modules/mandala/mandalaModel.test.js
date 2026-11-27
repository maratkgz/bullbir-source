import { describe, it, expect } from 'vitest'
import {
  emptyMandala, normalizeCell, normalizeMandala, normalizeChecks, normalizeInterview,
  cleanTimePerDay, withInterview, patchForCell,
} from './mandalaModel'

const TODAY = '2026-11-27'

describe('mandala-level fields', () => {
  it('gives old documents safe defaults', () => {
    const m = normalizeMandala({ title: 'Old', directions: [] }, { todayKey: TODAY })
    expect(m).toMatchObject({ status: 'active', why: '', interview: null, timePerDay: 30, checks: {} })
    expect(m.directions[0].actions[0].linkedIds).toEqual([])
  })

  it('keeps valid status and drops unknown ones', () => {
    expect(normalizeMandala({ status: 'draft' }).status).toBe('draft')
    expect(normalizeMandala({ status: 'archived' }).status).toBe('archived')
    expect(normalizeMandala({ status: 'deleted' }).status).toBe('active')
  })

  it('caps why and clamps timePerDay', () => {
    expect(normalizeMandala({ why: 'x'.repeat(400) }).why).toHaveLength(300)
    expect(cleanTimePerDay(2)).toBe(5)
    expect(cleanTimePerDay(1000)).toBe(240)
    expect(cleanTimePerDay('abc')).toBe(30)
    expect(cleanTimePerDay(45.4)).toBe(45)
    expect(normalizeMandala({ interview: { minutesPerDay: 90 } }).timePerDay).toBe(90)
  })

  it('normalizes the interview', () => {
    expect(normalizeInterview(null)).toBeNull()
    expect(normalizeInterview([])).toBeNull()
    const iv = normalizeInterview({ goal: ' Run ', life: 'y'.repeat(600), minutesPerDay: 0, sphere: 'Bad Id!', extra: 1 })
    expect(iv).toEqual({
      life: 'y'.repeat(500), goal: 'Run', why: '', has: '', failures: '', obstacles: '',
      minutesPerDay: 30, sphere: '',
    })
    expect(normalizeInterview({ sphere: 'health' }).sphere).toBe('health')
  })

  it('keeps only the last 14 days of checks with valid ids', () => {
    const checks = normalizeChecks({
      '2026-11-27': ['0-1', '0-1', '9-9', 3, '7-7'],
      '2026-11-14': ['1-1'],
      '2026-11-13': ['1-2'],
      '2026-11-30': ['1-1'],
      'nope': ['1-1'],
      '2026-11-20': 'x',
    }, TODAY)
    expect(checks).toEqual({ '2026-11-14': ['1-1'], '2026-11-27': ['0-1', '7-7'] })
    expect(normalizeChecks(null, TODAY)).toEqual({})
  })

  it('normalizes linkedIds on cells', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `t${i}`)
    expect(normalizeCell({ linkedIds: [...ids, 't1', 5, ''] }).linkedIds).toHaveLength(30)
    expect(normalizeCell({ linkedIds: ['a', 'a', 'b'] }).linkedIds).toEqual(['a', 'b'])
    expect(normalizeCell({ linkedIds: 'a' }).linkedIds).toEqual([])
  })

  it('keeps linkedIds when a cell is saved', () => {
    const m = normalizeMandala(emptyMandala('G'))
    const withLink = patchForCell(m, { kind: 'action', d: 1, a: 2 }, { text: 'A', linkedIds: ['task1'] })
    expect(withLink.directions[1].actions[2].linkedIds).toEqual(['task1'])
  })

  it('builds the interview fields for a new table without mutating the base', () => {
    const base = emptyMandala('Goal')
    const doc = withInterview(base, { goal: 'Goal', why: 'Because', minutesPerDay: 45, sphere: 'health' })
    expect(doc).toMatchObject({ title: 'Goal', status: 'active', why: 'Because', timePerDay: 45 })
    expect(doc.interview).toMatchObject({ goal: 'Goal', sphere: 'health', minutesPerDay: 45 })
    expect(base).not.toHaveProperty('status')
  })
})
