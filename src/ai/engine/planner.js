// Turns mandala actions into a week-by-week task plan.
import { directionProgress } from '../../components/modules/mandala/mandalaModel'
import { parseDay, addDays, toDateKey } from './dates'

const DAYS_PER_WEEK = 7
export const PLAN_LIMITS = { maxWeeks: 26, maxPerWeek: 14 }

const clamp = (n, min, max) => Math.min(Math.max(Math.round(Number(n) || 0), min), max)

function plannedKeys(existingTasks, mandalaId) {
  return new Set(
    (existingTasks || [])
      .filter((t) => t.mandalaRef && t.mandalaRef.id === mandalaId)
      .map((t) => `${t.mandalaRef.d}-${t.mandalaRef.a}`),
  )
}

/** Open actions grouped by direction; lagging directions (lowest progress) first. */
function openActionQueues(mandala, skip) {
  return mandala.directions
    .map((dir, d) => ({
      d,
      title: dir.text,
      progress: directionProgress(dir),
      queue: dir.actions
        .map((a, i) => ({ ...a, a: i }))
        .filter((a) => a.text.trim() && !a.done && !skip.has(`${d}-${a.a}`)),
    }))
    .filter((g) => g.queue.length > 0)
    .sort((x, y) => x.progress - y.progress || x.d - y.d)
}

/** Round-robin across directions so every area moves forward each week. */
function interleave(groups) {
  const queues = groups.map((g) => ({ ...g, queue: [...g.queue] }))
  const out = []
  let added = true
  while (added) {
    added = false
    queues.forEach((g) => {
      const next = g.queue.shift()
      if (next) { out.push({ ...next, d: g.d, dirTitle: g.title }); added = true }
    })
  }
  return out
}

/**
 * @param {object} mandala  normalized mandala with `id`
 * @param {{ startDate: string|Date, weeks: number, perWeek: number, existingTasks?: object[] }} options
 * @returns {object[]} task docs ready for useCollection('tasks').add()
 */
export function planTasks(mandala, { startDate, weeks, perWeek, existingTasks = [] }) {
  const w = clamp(weeks, 1, PLAN_LIMITS.maxWeeks)
  const p = clamp(perWeek, 1, PLAN_LIMITS.maxPerWeek)
  const start = parseDay(startDate) || new Date()
  const ordered = interleave(openActionQueues(mandala, plannedKeys(existingTasks, mandala.id)))

  return ordered.slice(0, w * p).map((item, k) => {
    const week = Math.floor(k / p)
    const deadline = toDateKey(addDays(start, week * DAYS_PER_WEEK + DAYS_PER_WEEK - 1))
    return {
      title: item.text,
      description: item.dirTitle ? `${mandala.title} → ${item.dirTitle}` : mandala.title,
      priority: week === 0 ? 'high' : 'medium',
      tags: ['mandala'],
      deadline,
      subtasks: [],
      status: 'todo',
      timeGroup: 'day',
      mandalaRef: { id: mandala.id, d: item.d, a: item.a },
    }
  })
}
