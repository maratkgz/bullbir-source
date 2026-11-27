// Activity heatmap data: one cell per day for the last 52 weeks, coloured by how much the
// user did that day. Pure, so it is unit-tested and the component stays small.
import { eachDayOfInterval, startOfWeek, subWeeks } from 'date-fns'
import { toDateKey } from '../../../utils/format'

const WEEKS = 52
// Points per kind of action (writing a journal entry is more effort than a tick).
const POINTS = { task: 1, habit: 1, mood: 1, journal: 2, mandala: 1 }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Firestore Timestamp | Date | ISO string | 'YYYY-MM-DD' → 'YYYY-MM-DD' (or null). */
function dayKey(value) {
  if (!value) return null
  if (typeof value === 'string' && DATE_RE.test(value)) return value
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  return Number.isNaN(date.getTime()) ? null : toDateKey(date)
}

function add(map, key, points) {
  if (key) map[key] = (map[key] || 0) + points
}

/** Points per day from every module that records "I did something". */
export function activityByDate({ tasks = [], habits = [], moods = [], journals = [], mandalas = [] }) {
  const map = {}
  tasks.filter((x) => x.status === 'done')
    .forEach((x) => add(map, dayKey(x.completedAt || x.updatedAt || x.createdAt), POINTS.task))
  habits.forEach((h) => (h.completions || []).forEach((d) => add(map, dayKey(d), POINTS.habit)))
  moods.forEach((x) => add(map, dayKey(x.date), POINTS.mood))
  journals.forEach((x) => add(map, dayKey(x.date), POINTS.journal))
  mandalas.forEach((m) => (m.directions || []).forEach((dir) => (dir.actions || [])
    .forEach((a) => { if (a?.done) add(map, dayKey(a.doneAt), POINTS.mandala) })))
  return map
}

/** Level 0–4 relative to the busiest day, like a contribution graph. */
export function levelFor(value, max) {
  if (!value) return 0
  if (value < max * 0.25) return 1
  if (value < max * 0.5) return 2
  if (value < max * 0.75) return 3
  return 4
}

/** Heatmap cells (oldest first) ending today. */
export function heatmapCells(data, today = new Date()) {
  const byDate = activityByDate(data)
  const max = Math.max(1, ...Object.values(byDate))
  const start = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), WEEKS - 1)
  return eachDayOfInterval({ start, end: today }).map((d) => {
    const key = toDateKey(d)
    const value = byDate[key] || 0
    return { key, value, level: levelFor(value, max) }
  })
}
