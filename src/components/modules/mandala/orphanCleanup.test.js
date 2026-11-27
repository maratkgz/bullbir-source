import { describe, expect, it } from 'vitest'
import { findOrphans } from './orphanCleanup'

describe('findOrphans', () => {
  const items = [
    { id: 'a', mandalaRef: { id: 'live', d: 0, a: 0 } },
    { id: 'b', mandalaRef: { id: 'gone', d: 1, a: 2 } },
    { id: 'c', title: 'my own task' },
    { id: 'd', mandalaId: 'gone' },
    { id: 'e', mandalaId: 'live' },
    { id: 'f', mandalaRef: {} },
  ]

  it('finds only items linked to a table that no longer exists', () => {
    expect(findOrphans(items, ['live']).map((x) => x.id)).toEqual(['b', 'd'])
  })

  it('never touches items without a table link', () => {
    expect(findOrphans(items, []).map((x) => x.id)).toEqual(['a', 'b', 'd', 'e'])
    expect(findOrphans([{ id: 'x' }], [])).toEqual([])
  })
})
