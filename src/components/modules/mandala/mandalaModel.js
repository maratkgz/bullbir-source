// Pure data helpers for the Mandala chart (Harada method / 9×9 goal grid).
// Document shape at users/{uid}/mandalas/{id}:
//   { title, center: Cell, directions: Direction[8] }
//   Cell      = { text, done, deadline: 'YYYY-MM-DD' | '', note, milestones: Milestone[] }
//   Direction = Cell & { actions: Cell[8] }
//   Milestone = { id, text, done, deadline }
// All updates return new objects — nothing is mutated in place.

export const SLOTS = 8
export const LIMITS = { text: 80, note: 1000, milestones: 12, milestoneText: 120 }

// The 8 directions sit clockwise around the centre, starting top-left.
// Index = direction number, value = position (0..8) inside a 3×3 block (4 = centre).
export const RING_POSITIONS = [0, 1, 2, 5, 8, 7, 6, 3]

export const DIRECTION_COLORS = [
  '#7c5cff', '#5ad1a5', '#f0a45a', '#e06a9a',
  '#60b8ff', '#f0c45a', '#9a8cff', '#4fd1c5',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function localDayKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

export function emptyCell() {
  return { text: '', done: false, doneAt: '', deadline: '', note: '', milestones: [] }
}

export function emptyMandala(title = '') {
  const text = title.slice(0, LIMITS.text)
  return {
    title: text,
    center: { ...emptyCell(), text },
    directions: Array.from({ length: SLOTS }, () => ({
      ...emptyCell(),
      actions: Array.from({ length: SLOTS }, emptyCell),
    })),
  }
}

/** Trims and caps user input so documents stay small and well-formed. */
export function normalizeCell(cell) {
  return {
    text: String(cell?.text || '').slice(0, LIMITS.text),
    done: !!cell?.done,
    doneAt: cell?.done && DATE_RE.test(cell?.doneAt || '') ? cell.doneAt : '',
    deadline: DATE_RE.test(cell?.deadline || '') ? cell.deadline : '',
    note: String(cell?.note || '').slice(0, LIMITS.note),
    milestones: (Array.isArray(cell?.milestones) ? cell.milestones : [])
      .slice(0, LIMITS.milestones)
      .map((m) => ({
        id: String(m?.id || ''),
        text: String(m?.text || '').slice(0, LIMITS.milestoneText),
        done: !!m?.done,
        deadline: DATE_RE.test(m?.deadline || '') ? m.deadline : '',
      })),
  }
}

/** Fills gaps so a partially-written document always has the full 8×8 structure. */
export function normalizeMandala(raw) {
  const directions = Array.from({ length: SLOTS }, (_, d) => {
    const src = raw?.directions?.[d] || {}
    return {
      ...normalizeCell(src),
      actions: Array.from({ length: SLOTS }, (__, i) => normalizeCell(src.actions?.[i])),
    }
  })
  return {
    id: raw?.id,
    title: String(raw?.title || ''),
    createdAt: raw?.createdAt,
    center: normalizeCell(raw?.center || { text: raw?.title }),
    directions,
  }
}

/** Ref: { kind: 'center' } | { kind: 'direction', d } | { kind: 'action', d, a } */
export function getCell(mandala, ref) {
  if (ref.kind === 'center') return mandala.center
  const dir = mandala.directions[ref.d]
  return ref.kind === 'direction' ? dir : dir.actions[ref.a]
}

/** Stamps doneAt when a cell becomes done (used for pace tracking). */
function withDoneDate(prev, next, todayKey) {
  if (!next.done) return { ...next, doneAt: '' }
  if (prev?.done && prev.doneAt) return { ...next, doneAt: prev.doneAt }
  return { ...next, doneAt: next.doneAt || todayKey }
}

/** Returns the Firestore patch for saving one cell (immutable). */
export function patchForCell(mandala, ref, cell, todayKey = localDayKey()) {
  const clean = normalizeCell(withDoneDate(getCell(mandala, ref), normalizeCell(cell), todayKey))
  if (ref.kind === 'center') return { center: clean, title: clean.text }
  const directions = mandala.directions.map((dir, d) => {
    if (d !== ref.d) return dir
    if (ref.kind === 'direction') return { ...dir, ...clean }
    return { ...dir, actions: dir.actions.map((a, i) => (i === ref.a ? clean : a)) }
  })
  return { directions }
}

const isFilled = (cell) => cell.text.trim().length > 0
const pct = (done, total) => (total === 0 ? 0 : Math.round((done / total) * 100))

/** Progress of one direction: share of its filled actions marked done (0..100). */
export function directionProgress(dir) {
  const actions = dir.actions.filter(isFilled)
  if (actions.length === 0) return dir.done ? 100 : 0
  return pct(actions.filter((a) => a.done).length, actions.length)
}

export function mandalaStats(mandala) {
  const actions = mandala.directions.flatMap((d) => d.actions).filter(isFilled)
  const actionsDone = actions.filter((a) => a.done).length
  return {
    directions: mandala.directions.filter(isFilled).length,
    actions: actions.length,
    actionsDone,
    progress: pct(actionsDone, actions.length),
  }
}

/** True when a not-done cell's deadline is before `todayKey` ('YYYY-MM-DD'). */
export function isOverdue(cell, todayKey) {
  return !cell.done && !!cell.deadline && cell.deadline < todayKey
}
