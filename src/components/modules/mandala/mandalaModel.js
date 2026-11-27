// Pure data helpers for the Mandala chart (Harada method / 9×9 goal grid).
// Document shape at users/{uid}/mandalas/{id}:
//   { title, center: Cell, directions: Direction[8] }
//   Cell      = { text, done, deadline: 'YYYY-MM-DD' | '', note, milestones: Milestone[],
//                 type: 'habit'|'milestone'|'quality'|'', freq: 'daily'|'3w'|'weekly'|'',
//                 minutes: 0..120 (0 = unknown), src: library ref like 'health:3:5' | '' }
//                 linkedIds: string[] (ids of tasks/habits created from the cell) }
//   Direction = Cell & { kind: 'direct'|'support'|'character'|'', actions: Cell[8] }
//   Milestone = { id, text, done, deadline }
// Mandala-level fields: status 'draft'|'active'|'archived' (missing → 'active'), why (≤300),
//   interview { life, goal, why, has, failures, obstacles, minutesPerDay, sphere } | null,
//   timePerDay 5..240 (default 30), checks { 'YYYY-MM-DD': ['d-i', ...] } (last 14 days).
// All updates return new objects — nothing is mutated in place.
import { ITEM_TYPES, FREQS, DIRECTION_KINDS } from '../../../ai/library/schema'

export const SLOTS = 8
export const LIMITS = {
  text: 80, note: 1000, milestones: 12, milestoneText: 120, minutes: 120, src: 80,
  linkedIds: 30, linkedId: 128, why: 300, answer: 500, sphere: 40, checkDays: 14,
}
export const STATUSES = ['draft', 'active', 'archived']
export const TIME_PER_DAY = { min: 5, max: 240, fallback: 30 }
export const INTERVIEW_FIELDS = ['life', 'goal', 'why', 'has', 'failures', 'obstacles']

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
  return {
    text: '', done: false, doneAt: '', deadline: '', note: '', milestones: [],
    type: '', freq: '', minutes: 0, src: '', linkedIds: [],
  }
}

const oneOf = (value, allowed) => (allowed.includes(value) ? value : '')

function cleanMinutes(value) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n > 0 ? Math.min(n, LIMITS.minutes) : 0
}

/** Direction kind (direct / support / character) or '' when unknown. */
export const normalizeKind = (kind) => oneOf(kind, DIRECTION_KINDS)

export function emptyMandala(title = '') {
  const text = title.slice(0, LIMITS.text)
  return {
    title: text,
    center: { ...emptyCell(), text },
    directions: Array.from({ length: SLOTS }, () => ({
      ...emptyCell(),
      kind: '',
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
    type: oneOf(cell?.type, ITEM_TYPES),
    freq: oneOf(cell?.freq, FREQS),
    minutes: cleanMinutes(cell?.minutes),
    src: typeof cell?.src === 'string' ? cell.src.slice(0, LIMITS.src) : '',
    linkedIds: cleanLinkedIds(cell?.linkedIds),
  }
}

function cleanLinkedIds(ids) {
  if (!Array.isArray(ids)) return []
  const valid = ids.filter((id) => typeof id === 'string' && id && id.length <= LIMITS.linkedId)
  return [...new Set(valid)].slice(0, LIMITS.linkedIds)
}

/** Minutes per day (5..240); anything invalid → 30. */
export function cleanTimePerDay(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n <= 0) return TIME_PER_DAY.fallback
  return Math.min(Math.max(n, TIME_PER_DAY.min), TIME_PER_DAY.max)
}

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** Interview summary or null when absent/invalid. */
export function normalizeInterview(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const texts = Object.fromEntries(INTERVIEW_FIELDS.map((f) => [f, cleanText(raw[f], LIMITS.answer)]))
  const sphere = typeof raw.sphere === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.sphere) ? raw.sphere : ''
  return { ...texts, minutesPerDay: cleanTimePerDay(raw.minutesPerDay), sphere }
}

const CHECK_ID_RE = /^[0-7]-[0-7]$/

function shiftDayKey(dayKey, days) {
  const [y, m, d] = dayKey.split('-').map(Number)
  return localDayKey(new Date(y, m - 1, d + days))
}

/** Quality-check ticks: valid day keys only, the 14 days up to `todayKey`, unique 'd-i' ids. */
export function normalizeChecks(raw, todayKey = localDayKey()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const oldest = shiftDayKey(todayKey, -(LIMITS.checkDays - 1))
  return Object.fromEntries(
    Object.keys(raw)
      .filter((k) => DATE_RE.test(k) && k >= oldest && k <= todayKey && Array.isArray(raw[k]))
      .sort()
      .slice(-LIMITS.checkDays)
      .map((k) => [k, [...new Set(raw[k].filter((id) => typeof id === 'string' && CHECK_ID_RE.test(id)))]]),
  )
}

/** Fills gaps so a partially-written document always has the full 8×8 structure. */
export function normalizeMandala(raw, { todayKey } = {}) {
  const directions = Array.from({ length: SLOTS }, (_, d) => {
    const src = raw?.directions?.[d] || {}
    return {
      ...normalizeCell(src),
      kind: normalizeKind(src.kind),
      actions: Array.from({ length: SLOTS }, (__, i) => normalizeCell(src.actions?.[i])),
    }
  })
  return {
    id: raw?.id,
    title: String(raw?.title || ''),
    createdAt: raw?.createdAt,
    center: normalizeCell(raw?.center || { text: raw?.title }),
    directions,
    status: STATUSES.includes(raw?.status) ? raw.status : 'active',
    why: cleanText(raw?.why, LIMITS.why),
    interview: normalizeInterview(raw?.interview),
    timePerDay: cleanTimePerDay(raw?.timePerDay ?? raw?.interview?.minutesPerDay),
    checks: normalizeChecks(raw?.checks, todayKey),
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

/**
 * Mandala-level fields for a table built from the interview (new object, inputs untouched).
 * @param {{ title, center, directions }} base  e.g. mandalaFromDomain(...) output
 * @param {object} summary interview summary (nextStep(...).summary, possibly edited)
 */
export function withInterview(base, summary) {
  const interview = normalizeInterview(summary)
  return {
    ...base,
    status: 'active',
    why: cleanText(interview?.why, LIMITS.why),
    interview,
    timePerDay: cleanTimePerDay(interview?.minutesPerDay),
  }
}
