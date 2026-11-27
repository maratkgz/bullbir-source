// Pure helpers for "My day" and the Sunday weekly review: active mandala, ISO week ids,
// quality check-ins and the next-week task plan (lagging directions get more slots).
import { normalizeMandala, directionProgress } from '../../components/modules/mandala/mandalaModel'
import { parseDay, addDays, toDateKey, DAY_MS } from './dates'

export const WEEK_PLAN = {
  days: 7, perDay: 3, perDayEase: 2, laggingWeight: 2, checksKeepDays: 14, reminderTime: '19:00',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CHECK_RE = /^[0-7]-[0-7]$/

const millis = (v) => {
  if (!v) return 0
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.seconds === 'number') return v.seconds * 1000
  const n = new Date(v).getTime()
  return Number.isFinite(n) ? n : 0
}

/** Keeps only well-formed day keys with lists of 'd-i' strings. */
export function normalizeChecks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw)
    .filter(([day, list]) => DATE_RE.test(day) && Array.isArray(list))
    .map(([day, list]) => [day, [...new Set(list.filter((k) => typeof k === 'string' && CHECK_RE.test(k)))]]))
}

/** The active mandala (most recently updated when several), normalized, or null. */
export function pickActiveMandala(docs = []) {
  const raw = docs
    .filter((doc) => doc?.status === 'active')
    .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt))[0]
  if (!raw) return null
  const base = normalizeMandala(raw)
  const minutes = Number(raw.timePerDay)
  return {
    ...base,
    status: 'active',
    timePerDay: Number.isFinite(minutes) && minutes > 0 ? minutes : 0,
    checks: normalizeChecks(raw.checks),
  }
}

/** Toggles `key` ('d-i') for `dayKey` and drops days older than `keepDays`. Returns a new object. */
export function toggleCheck(checks, dayKey, key, keepDays = WEEK_PLAN.checksKeepDays) {
  const clean = normalizeChecks(checks)
  const list = clean[dayKey] || []
  const nextList = list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
  const oldest = toDateKey(addDays(parseDay(dayKey), -(keepDays - 1)))
  const kept = Object.entries({ ...clean, [dayKey]: nextList }).filter(([day]) => day >= oldest)
  return Object.fromEntries(kept)
}

/** ISO-8601 week id 'YYYY-Www' of a local date. */
export function isoWeekId(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3) // Thursday of this week
  const year = d.getFullYear()
  const firstThursday = new Date(year, 0, 4)
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3)
  const week = 1 + Math.round((d - firstThursday) / (7 * DAY_MS))
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** The Sunday being reviewed: today on Sunday, yesterday on Monday, else the coming Sunday. */
export function reviewSunday(today) {
  const dow = today.getDay()
  if (dow === 0) return parseDay(toDateKey(today))
  if (dow === 1) return addDays(parseDay(toDateKey(today)), -1)
  return addDays(parseDay(toDateKey(today)), 7 - dow)
}

export const reviewWeekId = (today) => isoWeekId(reviewSunday(today))

/** First day of the planned week: the Monday after the reviewed Sunday. */
export const planStartDate = (today) => addDays(reviewSunday(today), 1)

/** Date key of the next Sunday strictly after today (the next review reminder). */
export function nextSundayKey(today) {
  const dow = today.getDay()
  return toDateKey(addDays(parseDay(toDateKey(today)), dow === 0 ? 7 : 7 - dow))
}

/** Dashboard banner: on Sunday, and on Monday while that week's review is not confirmed. */
export function shouldShowReviewBanner(today, reviewDoc) {
  const dow = today.getDay()
  return (dow === 0 || dow === 1) && !reviewDoc?.confirmed
}

/** Progress of every filled direction: [{ d, title, pct, done, total }]. */
export function directionStats(mandala) {
  if (!mandala) return []
  return mandala.directions
    .map((dir, d) => {
      const filled = dir.actions.filter((a) => a.text.trim())
      return { d, title: dir.text, pct: directionProgress(dir), done: filled.filter((a) => a.done).length, total: filled.length }
    })
    .filter((x) => x.title.trim() || x.total > 0)
}

const refKey = (ref) => `${ref.d}-${ref.a}`
const isOpen = (task) => task && task.status !== 'done' && task.status !== 'skipped'

/** Open tasks of this mandala keyed by 'd-a' (first one wins). */
function openTasksByRef(tasks, mandalaId) {
  return (tasks || [])
    .filter((t) => isOpen(t) && t.id && t.mandalaRef && t.mandalaRef.id === mandalaId)
    .reduce((map, t) => (map.has(refKey(t.mandalaRef)) ? map : map.set(refKey(t.mandalaRef), t)), new Map())
}

/** Per direction: plannable open actions (not qualities), ones already in tasks first. */
function directionQueues(mandala, open, laggingDs) {
  const rank = new Map(laggingDs.map((d, i) => [d, i]))
  return mandala.directions
    .map((dir, d) => ({
      d,
      lagging: rank.has(d),
      progress: directionProgress(dir),
      queue: dir.actions
        .map((cell, a) => ({ cell, a }))
        .filter(({ cell }) => cell.text.trim() && !cell.done && cell.type !== 'quality')
        .map(({ cell, a }) => ({ d, a, title: cell.text.trim(), taskId: open.get(`${d}-${a}`)?.id || null }))
        .sort((x, y) => Number(!!y.taskId) - Number(!!x.taskId) || x.a - y.a),
    }))
    .filter((g) => g.queue.length > 0)
    .sort((x, y) => (rank.get(x.d) ?? 99) - (rank.get(y.d) ?? 99) || x.progress - y.progress || x.d - y.d)
}

/** Weighted round-robin: lagging directions give `weight` items per round, others one. */
function interleave(groups, weight) {
  const queues = groups.map((g) => ({ ...g, queue: [...g.queue] }))
  const out = []
  while (queues.some((g) => g.queue.length)) {
    queues.forEach((g) => out.push(...g.queue.splice(0, g.lagging ? weight : 1)))
  }
  return out
}

/**
 * @param {{ mandala: object, tasks?: object[], lagging?: string[], ease?: boolean, startDate: Date|string }} input
 *   lagging = direction ids 'mandalaId:d' from weeklyCoachReview
 * @returns {Array<{ date: string, items: Array<{ d, a, title, taskId: string|null }> }>} 7 days
 */
export function buildWeekPlan({ mandala, tasks = [], lagging = [], ease = false, startDate }) {
  const start = parseDay(startDate) || new Date()
  const days = Array.from({ length: WEEK_PLAN.days }, (_, i) => toDateKey(addDays(start, i)))
  if (!mandala) return days.map((date) => ({ date, items: [] }))
  const perDay = ease ? WEEK_PLAN.perDayEase : WEEK_PLAN.perDay
  const prefix = `${mandala.id}:`
  const laggingDs = lagging.filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(prefix.length)))
  const ordered = interleave(directionQueues(mandala, openTasksByRef(tasks, mandala.id), laggingDs), WEEK_PLAN.laggingWeight)
  return days.map((date, i) => ({ date, items: ordered.slice(i * perDay, (i + 1) * perDay) }))
}

/**
 * Turns a confirmed plan into task writes. Items that already have an open task with the same
 * mandalaRef only get a new deadline; the rest become new task docs (planner.js shape).
 * @returns {{ creates: object[], updates: Array<{ id: string, patch: { deadline: string } }> }}
 */
export function planTaskOps(plan, mandala, tasks = []) {
  const open = openTasksByRef(tasks, mandala.id)
  return plan.reduce((acc, day, dayIndex) => {
    day.items.forEach((item) => {
      const existing = open.get(`${item.d}-${item.a}`)
      if (existing) {
        acc.updates.push({ id: existing.id, patch: { deadline: day.date } })
        return
      }
      const dirTitle = mandala.directions[item.d]?.text || ''
      acc.creates.push({
        title: item.title,
        description: dirTitle ? `${mandala.title} → ${dirTitle}` : mandala.title,
        priority: dayIndex === 0 ? 'high' : 'medium',
        tags: ['mandala'],
        deadline: day.date,
        subtasks: [],
        status: 'todo',
        timeGroup: 'day',
        mandalaRef: { id: mandala.id, d: item.d, a: item.a },
      })
    })
    return acc
  }, { creates: [], updates: [] })
}

/** The weeklyReviews document (without timestamps). `review` = weeklyCoachReview output. */
export function buildReviewDoc({ weekId, mandala, review, summaryText, plan }) {
  const vars = review.summary.key === 'ai.week.summary' ? review.summary.vars : { done: 0, planned: 0, pct: 0 }
  const prefix = `${mandala.id}:`
  return {
    weekId,
    mandalaId: mandala.id,
    stats: { directions: directionStats(mandala), tasksDone: vars.done, tasksPlanned: vars.planned, completionPct: vars.pct },
    summary: summaryText,
    lagging: review.lagging.filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(prefix.length))),
    plan: plan.map((day) => ({ date: day.date, titles: day.items.map((x) => x.title) })),
    confirmed: true,
  }
}

/** True when a not-done reminder with one of `titles` already exists on `dateKey`. */
export function hasReviewReminder(reminders, dateKey, titles) {
  return (reminders || []).some((r) => !r.done && r.date === dateKey && titles.includes(r.title))
}

/** Dev-only `?today=YYYY-MM-DD` override for testing Sunday/Monday flows. */
export function todayFromSearch(search, enabled) {
  if (!enabled) return new Date()
  const value = new URLSearchParams(search || '').get('today')
  return (value && DATE_RE.test(value) && parseDay(value)) || new Date()
}
