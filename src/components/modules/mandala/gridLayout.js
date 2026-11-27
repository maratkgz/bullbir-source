// Pure layout helpers for the 9×9 grid and the mobile 3×3 views.
import { RING_POSITIONS } from './mandalaModel'

export const CENTER_POS = 4
export const BLOCK_POSITIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
/** Position (0..8) → direction/action index; inverse of RING_POSITIONS. */
export const INDEX_AT_POS = Object.fromEntries(RING_POSITIONS.map((pos, i) => [pos, i]))

const WAVE_STEP = 0.05 // seconds per unit of distance from the centre
const WAVE_MAX = 0.4

const rowOf = (pos) => Math.floor(pos / 3)
const colOf = (pos) => pos % 3

/** Distance of a cell from the centre of the full 9×9 grid (0 = goal, ≈5.66 = corner). */
export function gridDistance(blockPos, innerPos) {
  const row = rowOf(blockPos) * 3 + rowOf(innerPos)
  const col = colOf(blockPos) * 3 + colOf(innerPos)
  return Math.hypot(row - 4, col - 4)
}

/** Distance of a cell from the centre of a single 3×3 block (0, 1 or ≈1.41). */
export const blockDistance = (pos) => Math.hypot(rowOf(pos) - 1, colOf(pos) - 1)

/** Animation delay (s) for the "wave from the centre" entrance. */
export const waveDelay = (distance) => Math.min(Math.max(distance, 0) * WAVE_STEP, WAVE_MAX)

/**
 * The 9 cells of one 3×3 block, in visual order.
 * @param {object} mandala normalized mandala
 * @param {number|null} focus null = centre block (goal + 8 directions), 0..7 = that direction
 * @returns {Array<{ pos, kind: 'center'|'direction'|'action', d: number|null, a: number|null, ref, cell }>}
 */
export function blockCells(mandala, focus) {
  return BLOCK_POSITIONS.map((pos) => {
    const isCenter = pos === CENTER_POS
    if (focus === null || focus === undefined) {
      if (isCenter) return { pos, kind: 'center', d: null, a: null, ref: { kind: 'center' }, cell: mandala.center }
      const d = INDEX_AT_POS[pos]
      return { pos, kind: 'direction', d, a: null, ref: { kind: 'direction', d }, cell: mandala.directions[d] }
    }
    const dir = mandala.directions[focus]
    if (isCenter) return { pos, kind: 'direction', d: focus, a: null, ref: { kind: 'direction', d: focus }, cell: dir }
    const a = INDEX_AT_POS[pos]
    return { pos, kind: 'action', d: focus, a, ref: { kind: 'action', d: focus, a }, cell: dir.actions[a] }
  })
}

/** Block position (0..8) of each block in the full grid → focus (null = centre block). */
export const focusAtBlock = (blockPos) => (blockPos === CENTER_POS ? null : INDEX_AT_POS[blockPos])
