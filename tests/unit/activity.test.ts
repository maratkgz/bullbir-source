import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without type declarations
import { activityByDate, heatmapCells, levelFor } from '../../src/components/modules/progress/activity.js'

describe('activity heatmap', () => {
  it('counts habits, done tasks, moods, journals and done table items', () => {
    const map = activityByDate({
      habits: [{ completions: ['2026-11-20', '2026-11-21'] }],
      tasks: [
        { status: 'done', completedAt: '2026-11-20T10:00:00' },
        { status: 'todo', updatedAt: '2026-11-20T10:00:00' },
      ],
      moods: [{ date: '2026-11-21' }],
      journals: [{ date: '2026-11-21' }],
      mandalas: [{ directions: [{ actions: [{ done: true, doneAt: '2026-11-22' }, { done: false }] }] }],
    })
    expect(map).toEqual({ '2026-11-20': 2, '2026-11-21': 4, '2026-11-22': 1 })
  })

  it('reads Firestore timestamps', () => {
    const ts = { toDate: () => new Date(2026, 10, 19, 12) }
    expect(activityByDate({ tasks: [{ status: 'done', updatedAt: ts }] })).toEqual({ '2026-11-19': 1 })
  })

  it('ignores bad dates instead of crashing', () => {
    expect(activityByDate({ habits: [{ completions: ['nope', null] }], tasks: [{ status: 'done' }] })).toEqual({})
  })

  it('gives levels relative to the busiest day', () => {
    expect([0, 1, 3, 5, 8].map((v) => levelFor(v, 8))).toEqual([0, 1, 2, 3, 4])
  })

  it('ends the grid today with today counted', () => {
    const today = new Date(2026, 10, 27)
    const cells = heatmapCells({ habits: [{ completions: ['2026-11-27'] }] }, today)
    expect(cells[cells.length - 1]).toEqual({ key: '2026-11-27', value: 1, level: 4 })
    expect(cells.length).toBeGreaterThan(51 * 7)
  })
})
