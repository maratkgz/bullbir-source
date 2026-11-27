import { describe, expect, it } from 'vitest'
import { linkedCounts, linkedToMandala } from './mandalaLinks'

const tasks = [
  { id: 't1', mandalaRef: { id: 'm1', d: 0, a: 1 } },
  { id: 't2', mandalaRef: { id: 'm2', d: 0, a: 1 } },
  { id: 't3' },
]
const habits = [{ id: 'h1', mandalaRef: { id: 'm1', d: 2, a: 0 } }, { id: 'h2', title: 'own habit' }]
const reviews = [{ id: '2026-W48', mandalaId: 'm1' }, { id: '2026-W47', mandalaId: 'm2' }]

describe('mandala links', () => {
  it('finds only the items created from this mandala', () => {
    expect(linkedToMandala(tasks, 'm1').map((x) => x.id)).toEqual(['t1'])
    expect(linkedToMandala(habits, 'm1').map((x) => x.id)).toEqual(['h1'])
    expect(linkedToMandala(reviews, 'm1').map((x) => x.id)).toEqual(['2026-W48'])
  })

  it('never matches without an id (protects the user’s own items)', () => {
    expect(linkedToMandala(tasks, undefined)).toEqual([])
    expect(linkedToMandala([{ mandalaRef: {} }], undefined)).toEqual([])
  })

  it('counts per kind', () => {
    expect(linkedCounts({ tasks, habits, reviews }, 'm1')).toEqual({ tasks: 1, habits: 1, reviews: 1 })
    expect(linkedCounts({}, 'm1')).toEqual({ tasks: 0, habits: 0, reviews: 0 })
  })
})
