import { describe, it, expect } from 'vitest'
import { emptyMandala, normalizeMandala, RING_POSITIONS } from './mandalaModel'
import { blockCells, blockDistance, gridDistance, waveDelay, focusAtBlock, CENTER_POS } from './gridLayout'

const mandala = () => {
  const m = normalizeMandala(emptyMandala('Goal'))
  return {
    ...m,
    directions: m.directions.map((dir, d) => ({
      ...dir, text: `D${d}`, actions: dir.actions.map((a, i) => ({ ...a, text: `A${d}.${i}` })),
    })),
  }
}

describe('gridLayout', () => {
  it('centre block = goal surrounded by the 8 directions', () => {
    const cells = blockCells(mandala(), null)
    expect(cells).toHaveLength(9)
    expect(cells[CENTER_POS]).toMatchObject({ kind: 'center', ref: { kind: 'center' } })
    RING_POSITIONS.forEach((pos, d) => {
      expect(cells[pos]).toMatchObject({ kind: 'direction', d, ref: { kind: 'direction', d } })
      expect(cells[pos].cell.text).toBe(`D${d}`)
    })
  })

  it('direction block = direction in the middle, its 8 actions around', () => {
    const cells = blockCells(mandala(), 3)
    expect(cells[CENTER_POS]).toMatchObject({ kind: 'direction', d: 3 })
    RING_POSITIONS.forEach((pos, a) => {
      expect(cells[pos]).toMatchObject({ kind: 'action', d: 3, a, ref: { kind: 'action', d: 3, a } })
      expect(cells[pos].cell.text).toBe(`A3.${a}`)
    })
  })

  it('measures distance from the centre', () => {
    expect(gridDistance(4, 4)).toBe(0)
    expect(gridDistance(4, 1)).toBe(1)
    expect(gridDistance(0, 0)).toBeCloseTo(Math.hypot(4, 4))
    expect(blockDistance(4)).toBe(0)
    expect(blockDistance(1)).toBe(1)
    expect(blockDistance(0)).toBeCloseTo(Math.SQRT2)
  })

  it('wave delay grows with distance and is capped', () => {
    expect(waveDelay(0)).toBe(0)
    expect(waveDelay(2)).toBeGreaterThan(waveDelay(1))
    expect(waveDelay(100)).toBe(0.4)
    expect(waveDelay(-1)).toBe(0)
  })

  it('maps grid blocks to focus', () => {
    expect(focusAtBlock(4)).toBeNull()
    expect(focusAtBlock(RING_POSITIONS[5])).toBe(5)
  })
})
