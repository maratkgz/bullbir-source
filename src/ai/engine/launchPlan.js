// "Launch plan": turns a filled mandala into BullBir planner docs.
//   habit     → one doc in `habits` (frequency + link back to the cell)
//   milestone → its breakdown steps become dated tasks (one step per milestone per day,
//               daily sum of step minutes ≤ mandala.timePerDay where possible)
//   quality   → no docs; returned so the UI can show them (morning checklist)
// Everything here is pure and deterministic; the component writes the docs.
import { DIRECTION_COLORS } from '../../components/modules/mandala/mandalaModel'
import { inferType, inferFreq } from './itemTypes'
import { breakdownMilestone } from './breakdown'
import { parseDay, addDays, toDateKey } from './dates'

export const DEFAULT_TIME_PER_DAY = 30
export const LAUNCH_TAG = 'mandala'
// One sensible default emoji per direction index (clockwise from top-left).
export const DIRECTION_EMOJIS = ['🎯', '💪', '📚', '💰', '❤️', '🧠', '🌿', '✍️']
const FALLBACK_EMOJI = '🎯'
// Safety bound for the scheduler: never look further than this many days ahead.
const MAX_HORIZON_DAYS = 730

const isOpen = (cell) => !!cell && !cell.done && String(cell.text || '').trim().length > 0
const cellKey = (d, a) => `${d}-${a}`
const stepKey = (d, a, step) => `${d}-${a}-${step}`
const sameMandala = (doc, id) => !!doc?.mandalaRef && doc.mandalaRef.id === id

/** Minutes a day the user gives the plan (mandala.timePerDay, default 30). */
export function dayBudget(mandala) {
  const n = Math.round(Number(mandala?.timePerDay))
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIME_PER_DAY
}

/**
 * Every open (text, not done) action of the mandala with its effective type.
 * @returns {Array<{ d: number, a: number, cell: object, dir: object, type: string }>}
 */
export function launchItems(mandala) {
  return (mandala?.directions || []).flatMap((dir, d) => (dir?.actions || [])
    .map((cell, a) => ({ d, a, cell, dir, type: cell?.type || inferType(cell?.text || '') }))
    .filter((item) => isOpen(item.cell)))
}

/** Habit doc for one cell, ready for useCollection('habits').add(). */
export function habitDoc(mandala, { d, a, cell }) {
  return {
    title: cell.text.trim(),
    emoji: DIRECTION_EMOJIS[d] || FALLBACK_EMOJI,
    color: DIRECTION_COLORS[d] || DIRECTION_COLORS[0],
    completions: [],
    freq: cell.freq || inferFreq(cell.text),
    mandalaRef: { id: mandala.id, d, a },
  }
}

/** Milestones with the steps that still need tasks (already created steps are dropped). */
function milestoneQueues(mandala, items, { lang, domains, existingTasks }) {
  const created = new Set((existingTasks || [])
    .filter((t) => sameMandala(t, mandala.id) && Number.isInteger(t.step))
    .map((t) => stepKey(t.mandalaRef.d, t.mandalaRef.a, t.step)))
  const minutesPerDay = dayBudget(mandala)
  return items.map((item) => {
    const { steps } = breakdownMilestone(item.cell, { minutesPerDay, lang, domains })
    const all = steps.map((s, step) => ({ ...s, step }))
    const queue = all.filter((s) => !created.has(stepKey(item.d, item.a, s.step)))
    return { ...item, queue, skipped: all.length - queue.length }
  })
}

/** Earliest day ≥ `from` whose load leaves room for `minutes`; `from` when none fits. */
function firstFreeDay(load, from, minutes, cap) {
  for (let day = from; day < from + MAX_HORIZON_DAYS; day += 1) {
    if ((load.get(day) || 0) + minutes <= cap) return day
  }
  return from
}

/**
 * Places milestone steps on day offsets. Round-robin over milestones (step 0 of each, then
 * step 1…), every step strictly after the previous step of the same milestone, on the first
 * day whose total minutes stay ≤ cap.
 * @returns {Array<{ item: object, step: object, day: number }>} sorted by day, then cell
 */
export function scheduleSteps(queues, cap) {
  const load = new Map()
  const nextDay = queues.map(() => 0)
  const placed = []
  const rounds = Math.max(0, ...queues.map((q) => q.queue.length))
  for (let k = 0; k < rounds; k += 1) {
    queues.forEach((q, i) => {
      const step = q.queue[k]
      if (!step) return
      const day = firstFreeDay(load, nextDay[i], step.minutes, cap)
      load.set(day, (load.get(day) || 0) + step.minutes)
      nextDay[i] = day + 1
      placed.push({ item: q, step, day })
    })
  }
  return placed.sort((x, y) => x.day - y.day || x.item.d - y.item.d || x.item.a - y.item.a)
}

/** Task doc for one scheduled step, shaped like planner.js output plus `step` and `minutes`. */
export function stepTaskDoc(mandala, { item, step, day }, start) {
  const goal = String(mandala.title || mandala.center?.text || '').trim()
  const dirTitle = String(item.dir?.text || '').trim()
  return {
    title: `${item.cell.text.trim()}: ${step.title}`,
    description: dirTitle ? `${goal} → ${dirTitle}` : goal,
    priority: day === 0 ? 'high' : 'medium',
    tags: dirTitle ? [LAUNCH_TAG, dirTitle] : [LAUNCH_TAG],
    deadline: toDateKey(addDays(start, day)),
    subtasks: [],
    status: 'todo',
    timeGroup: 'day',
    minutes: step.minutes,
    mandalaRef: { id: mandala.id, d: item.d, a: item.a },
    step: step.step,
  }
}

/**
 * Builds the launch of a mandala into the planner.
 * @param {object} mandala normalized mandala with `id` (and optional `timePerDay`)
 * @param {{ today?: string|Date, lang?: 'en'|'kg'|'ru', domains?: object[],
 *   existingTasks?: object[], existingHabits?: object[] }} [options]
 * @returns {{ habits: object[], tasks: object[], qualities: Array<{ d, a, text }>,
 *   skipped: number, days: number }} docs to add; `skipped` = items already launched,
 *   `days` = number of calendar days the tasks span
 */
export function buildLaunch(mandala, { today, lang = 'ru', domains = [], existingTasks = [], existingHabits = [] } = {}) {
  const items = launchItems(mandala)
  const byType = (type) => items.filter((i) => i.type === type)
  const linkedHabits = new Set((existingHabits || [])
    .filter((h) => sameMandala(h, mandala.id))
    .map((h) => cellKey(h.mandalaRef.d, h.mandalaRef.a)))
  const habitItems = byType('habit')
  const freshHabits = habitItems.filter((i) => !linkedHabits.has(cellKey(i.d, i.a)))
  const queues = milestoneQueues(mandala, byType('milestone'), { lang, domains, existingTasks })
  const start = parseDay(today) || new Date()
  const placed = scheduleSteps(queues, dayBudget(mandala))
  const lastDay = Math.max(-1, ...placed.map((p) => p.day))
  return {
    habits: freshHabits.map((i) => habitDoc(mandala, i)),
    tasks: placed.map((p) => stepTaskDoc(mandala, p, start)),
    qualities: byType('quality').map(({ d, a, cell }) => ({ d, a, text: cell.text.trim() })),
    skipped: habitItems.length - freshHabits.length + queues.reduce((n, q) => n + q.skipped, 0),
    days: lastDay + 1,
  }
}

/**
 * New directions array with created doc ids appended to each cell's `linkedIds`
 * (existing ids kept, no duplicates). Input is not mutated.
 * @param {object} mandala normalized mandala
 * @param {Array<{ d: number, a: number, id: string }>} links
 * @returns {object[]} directions for useCollection('mandalas').update()
 */
export function withLinkedIds(mandala, links) {
  const byCell = new Map()
  links.filter((l) => l && l.id).forEach((l) => {
    const key = cellKey(l.d, l.a)
    byCell.set(key, [...(byCell.get(key) || []), String(l.id)])
  })
  return mandala.directions.map((dir, d) => ({
    ...dir,
    actions: dir.actions.map((cell, a) => {
      const added = byCell.get(cellKey(d, a))
      if (!added) return cell
      const prev = Array.isArray(cell.linkedIds) ? cell.linkedIds : []
      return { ...cell, linkedIds: [...new Set([...prev, ...added])] }
    }),
  }))
}
