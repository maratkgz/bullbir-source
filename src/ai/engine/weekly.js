// Weekly coach review: wins first (concrete), then lagging directions, one piece of advice and
// a light plan for the next 7 days. Pure and deterministic; the UI translates the keys.
import { directionProgress } from '../../components/modules/mandala/mandalaModel'
import { parseDay, addDays, toDateKey } from './dates'
import { habitStats } from './insights'

export const WEEKLY = { windowDays: 7, easeRate: 0.4, keepRate: 0.8, perDay: 3, perDayEase: 2, laggingPct: 50, minStreak: 2 }

const dayKey = (value) => {
  const d = value ? parseDay(value) : null
  return d && !Number.isNaN(d.getTime()) ? toDateKey(d) : ''
}
const inWindow = (key, from, to) => !!key && key >= from && key <= to
const directionsOf = (mandalas) => mandalas.flatMap((m) => m.directions.map((dir, d) => ({ m, dir, d, id: `${m.id}:${d}` })))

/** Tasks planned for (deadline) or finished in the window, and how many of them are done. */
function weekTasks(tasks, from, to) {
  const due = tasks.filter((t) => inWindow(dayKey(t.deadline), from, to)
    || (t.status === 'done' && inWindow(dayKey(t.completedAt), from, to)))
  return { planned: due.length, done: due.filter((t) => t.status === 'done').length }
}

/** Completion rate 0..1 of the week (tasks; habits when no task was planned), null when no data. */
function completionRate(week, habits, from, to) {
  if (week.planned > 0) return week.done / week.planned
  return habits.length ? habitStats(habits, from, to).rate : null
}

/** Consecutive check-in days ending today (or yesterday, if today is not checked yet). */
export function habitStreak(completions, today) {
  const set = new Set(completions || [])
  let cursor = set.has(toDateKey(today)) ? today : addDays(today, -1)
  let days = 0
  while (set.has(toDateKey(cursor))) {
    days += 1
    cursor = addDays(cursor, -1)
  }
  return days
}

function directionWin(mandalas, from, to) {
  const best = directionsOf(mandalas)
    .map((x) => ({ ...x, n: x.dir.actions.filter((a) => a.done && inWindow(a.doneAt, from, to)).length }))
    .filter((x) => x.n > 0 && x.dir.text.trim())
    .sort((a, b) => b.n - a.n)[0]
  return best ? { key: 'ai.week.win.direction', vars: { direction: best.dir.text, n: best.n } } : null
}

function streakWin(habits, today) {
  const best = habits
    .map((h) => ({ habit: h.title || h.name || '', days: habitStreak(h.completions, today) }))
    .sort((a, b) => b.days - a.days)[0]
  return best && best.days >= WEEKLY.minStreak ? { key: 'ai.week.win.streak', vars: best } : null
}

function laggingDirections(mandalas) {
  return directionsOf(mandalas)
    .filter((x) => x.dir.text.trim() && x.dir.actions.some((a) => a.text.trim()))
    .map((x) => ({ id: x.id, pct: directionProgress(x.dir), text: x.dir.text }))
    .filter((x) => x.pct < WEEKLY.laggingPct)
    .sort((a, b) => a.pct - b.pct)
}

function adviceFor(ease, lagging, rate) {
  if (ease) return { key: 'ai.week.advice.ease', vars: {} }
  if (lagging.length) return { key: 'ai.week.advice.lagging', vars: { direction: lagging[0].text } }
  if (rate !== null && rate >= WEEKLY.keepRate) return { key: 'ai.week.advice.keep', vars: {} }
  return { key: 'ai.week.advice.steady', vars: {} }
}

/** Open tasks ordered (overdue, lagging direction, deadline) and interleaved across directions. */
function nextWeekPlan(tasks, lagging, perDay, todayKey) {
  const rank = new Map(lagging.map((x, i) => [x.id, i]))
  const dirOf = (t) => (t.mandalaRef ? `${t.mandalaRef.id}:${t.mandalaRef.d}` : '')
  const score = (t) => {
    const dl = dayKey(t.deadline)
    return [dl && dl < todayKey ? 0 : 1, rank.has(dirOf(t)) ? rank.get(dirOf(t)) : lagging.length, dl || '9999']
  }
  const cmp = (a, b) => {
    const [x, y] = [score(a), score(b)]
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2])
  }
  const open = tasks.filter((t) => t.status !== 'done' && t.id).sort(cmp)
  const groups = [...open.reduce((g, t) => g.set(dirOf(t) || t.id, [...(g.get(dirOf(t) || t.id) || []), t]), new Map()).values()]
  const depth = Math.max(0, ...groups.map((g) => g.length))
  const ordered = Array.from({ length: depth }, (_, k) => groups.map((g) => g[k]).filter(Boolean)).flat()
  return Array.from({ length: WEEKLY.windowDays }, (_, i) => ({
    day: i + 1,
    taskIds: ordered.slice(i * perDay, (i + 1) * perDay).map((t) => t.id),
  }))
}

/**
 * @param {{ tasks?: object[], habits?: object[], mandalas?: object[] }} data mandalas normalized with `id`
 * @param {Date} [today]
 * @returns {{ summary: {key,vars}, wins: Array<{key,vars}>, lagging: string[], advice: {key,vars},
 *   nextWeek: Array<{ day: number, taskIds: string[] }>, ease: boolean }}
 */
export function weeklyCoachReview({ tasks = [], habits = [], mandalas = [] } = {}, today = new Date()) {
  const to = toDateKey(today)
  const from = toDateKey(addDays(today, -(WEEKLY.windowDays - 1)))
  const week = weekTasks(tasks, from, to)
  const rate = completionRate(week, habits, from, to)
  const ease = rate !== null && rate < WEEKLY.easeRate
  const lagging = laggingDirections(mandalas)
  const wins = [
    directionWin(mandalas, from, to),
    streakWin(habits, today),
    week.done > 0 ? { key: 'ai.week.win.tasks', vars: { n: week.done } } : null,
  ].filter(Boolean)
  const summary = rate === null
    ? { key: 'ai.week.summary.empty', vars: {} }
    : { key: 'ai.week.summary', vars: { done: week.done, planned: week.planned, pct: Math.round(rate * 100) } }
  return {
    summary,
    wins,
    lagging: lagging.map((x) => x.id),
    advice: adviceFor(ease, lagging, rate),
    nextWeek: nextWeekPlan(tasks, lagging, ease ? WEEKLY.perDayEase : WEEKLY.perDay, to),
    ease,
  }
}
