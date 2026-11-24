import { describe, it, expect } from 'vitest'
import { mandalaPace } from './pace'
import { computeRewards, levelForXp } from './rewards'
import { emptyMandala, normalizeMandala, patchForCell } from '../../components/modules/mandala/mandalaModel'

const TODAY = new Date(2026, 0, 31) // 2026-01-31, local

/** 16 filled actions; `doneDates` marks the first N of them done on those days. */
function mandalaWith({ deadline = '', doneDates = [] }) {
  const base = emptyMandala('Become a programmer')
  let i = 0
  const directions = base.directions.map((dir, d) => ({
    ...dir,
    text: d < 2 ? `Dir ${d}` : '',
    actions: dir.actions.map((a) => {
      if (d >= 2) return a
      const doneAt = doneDates[i]
      i += 1
      return { ...a, text: 'step', done: !!doneAt, doneAt: doneAt || '' }
    }),
  }))
  return normalizeMandala({ ...base, center: { ...base.center, deadline }, directions })
}

describe('mandalaPace', () => {
  it('is on track when the recent rate matches the required rate', () => {
    // 4 done in the last 4 weeks → 1/week; 12 left with 12 weeks to go → 1/week needed
    const m = mandalaWith({ deadline: '2026-04-25', doneDates: ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'] })
    const pace = mandalaPace(m, TODAY)
    expect(pace.status).toBe('on-track')
    expect(pace.weeklyRate).toBe(1)
    expect(pace.remaining).toBe(12)
  })

  it('reports behind with the delay and the rate needed', () => {
    const m = mandalaWith({ deadline: '2026-03-07', doneDates: ['2026-01-20'] }) // 15 left, 5 weeks
    const pace = mandalaPace(m, TODAY)
    expect(pace.status).toBe('behind')
    expect(pace.requiredRate).toBe(3)
    expect(pace.delayWeeks).toBeGreaterThan(0)
  })

  it('reports ahead when faster than needed', () => {
    const dates = Array.from({ length: 8 }, (_, k) => `2026-01-${String(10 + k).padStart(2, '0')}`)
    const pace = mandalaPace(mandalaWith({ deadline: '2026-12-31', doneDates: dates }), TODAY)
    expect(pace.status).toBe('ahead')
  })

  it('projects a finish date when there is no deadline', () => {
    const pace = mandalaPace(mandalaWith({ doneDates: ['2026-01-20', '2026-01-27'] }), TODAY)
    expect(pace.status).toBe('no-deadline')
    expect(pace.projectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('is "not-started" with no activity and "done" when finished', () => {
    expect(mandalaPace(mandalaWith({}), TODAY).status).toBe('not-started')
    const all = Array.from({ length: 16 }, () => '2026-01-20')
    expect(mandalaPace(mandalaWith({ doneDates: all }), TODAY).status).toBe('done')
  })
})

describe('patchForCell doneAt', () => {
  it('stamps today when an action becomes done and clears it when undone', () => {
    const m = mandalaWith({})
    const ref = { kind: 'action', d: 0, a: 0 }
    const done = patchForCell(m, ref, { ...m.directions[0].actions[0], done: true }, '2026-01-31')
    expect(done.directions[0].actions[0].doneAt).toBe('2026-01-31')
    const next = normalizeMandala({ ...m, ...done })
    const undone = patchForCell(next, ref, { ...next.directions[0].actions[0], done: false }, '2026-02-01')
    expect(undone.directions[0].actions[0].doneAt).toBe('')
  })
})

describe('computeRewards', () => {
  it('gives XP and badges for mandala progress', () => {
    const all = Array.from({ length: 16 }, (_, k) => `2026-01-${String(10 + k).padStart(2, '0')}`)
    const r = computeRewards({ mandalas: [mandalaWith({ doneDates: all })] })
    expect(r.xp).toBeGreaterThan(0)
    const unlocked = r.badges.filter((b) => b.unlocked).map((b) => b.id)
    expect(unlocked).toEqual(expect.arrayContaining(['first-mandala', 'first-step', 'direction-master']))
    expect(unlocked).not.toContain('balanced')
  })

  it('starts at level 1 with nothing unlocked', () => {
    const r = computeRewards({ mandalas: [] })
    expect(r.level).toBe(1)
    expect(r.badges.every((b) => !b.unlocked)).toBe(true)
  })

  it('levels grow with XP', () => {
    expect(levelForXp(0).level).toBe(1)
    expect(levelForXp(1000).level).toBeGreaterThan(levelForXp(100).level)
  })
})
