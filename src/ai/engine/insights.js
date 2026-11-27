// Weekly review: deterministic analytics over the user's own data, run in the browser.
// Insights carry i18n keys + vars; the UI translates them (EN / KG / RU).
import { directionProgress, mandalaStats } from '../../components/modules/mandala/mandalaModel'
import { parseDay, addDays, toDateKey } from './dates'
import { mandalaPace } from './pace'

const WINDOW_DAYS = 7
const MOOD_LOW = 1.5
const MOOD_GOOD = 3
const HABITS_GOOD_RATE = 0.7
const HABITS_LOW_RATE = 0.3
const PRODUCTIVE_TASKS = 5
const LAGGING_PCT = 50

const round1 = (n) => Math.round(n * 10) / 10
const inWindow = (key, from, to) => !!key && key >= from && key <= to

function taskStats(tasks, from, to) {
  const done = tasks.filter((t) => t.status === 'done' && t.completedAt
    && inWindow(toDateKey(parseDay(t.completedAt)), from, to)).length
  const overdue = tasks.filter((t) => t.status === 'todo' && t.deadline
    && toDateKey(parseDay(t.deadline)) < to).length
  return { done, overdue }
}

/** Habit check-ins in [from, to] and the share of possible daily check-ins (0..1). */
export function habitStats(habits, from, to) {
  const checkins = habits.reduce(
    (n, h) => n + (h.completions || []).filter((k) => inWindow(k, from, to)).length, 0,
  )
  const rate = habits.length ? checkins / (habits.length * WINDOW_DAYS) : 0
  return { checkins, rate }
}

function moodStats(moods, from, to) {
  const values = moods.filter((m) => inWindow(m.date, from, to)).map((m) => Number(m.value))
  return values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null
}

/** The least-advanced direction that already has actions, across all mandalas. */
function laggingDirection(mandalas) {
  let worst = null
  mandalas.forEach((m) => m.directions.forEach((dir) => {
    if (!dir.text.trim() || !dir.actions.some((a) => a.text.trim())) return
    const pct = directionProgress(dir)
    if (pct < LAGGING_PCT && (!worst || pct < worst.pct)) worst = { dir: dir.text, mandala: m.title, pct }
  }))
  return worst
}

/** Translates the pace of one mandala into an insight (or null when there is nothing to say). */
function paceInsight(m, today) {
  const p = mandalaPace(m, today)
  const vars = { title: m.title, rate: p.weeklyRate, required: p.requiredRate, delay: p.delayWeeks, date: p.projectedDate }
  if (p.status === 'behind') return { kind: 'pace', severity: 'warn', key: p.delayWeeks ? 'ai.ins.paceBehind' : 'ai.ins.paceStalled', vars }
  if (p.status === 'ahead') return { kind: 'pace', severity: 'good', key: 'ai.ins.paceAhead', vars }
  if (p.status === 'on-track') return { kind: 'pace', severity: 'good', key: 'ai.ins.paceOnTrack', vars }
  if (p.status === 'no-deadline' && p.projectedDate) return { kind: 'pace', severity: 'info', key: 'ai.ins.paceProjected', vars }
  return null
}

function nextAction(mandalas) {
  for (const m of mandalas) {
    for (const dir of m.directions) {
      const a = dir.actions.find((x) => x.text.trim() && !x.done)
      if (a) return a.text
    }
  }
  return null
}

/**
 * @param {{ tasks: object[], habits: object[], moods: object[], mandalas: object[] }} data
 *   mandalas must be normalized (normalizeMandala)
 * @param {Date} [today]
 */
export function weeklyReview({ tasks = [], habits = [], moods = [], mandalas = [] }, today = new Date()) {
  const to = toDateKey(today)
  const from = toDateKey(addDays(today, -(WINDOW_DAYS - 1)))
  const t = taskStats(tasks, from, to)
  const h = habitStats(habits, from, to)
  const moodAvg = moodStats(moods, from, to)
  const lag = laggingDirection(mandalas)
  const next = nextAction(mandalas)

  const insights = []
  if (t.overdue > 0) insights.push({ kind: 'overdue', severity: 'warn', key: 'ai.ins.overdue', vars: { n: t.overdue } })
  if (lag) insights.push({ kind: 'lagging', severity: 'warn', key: 'ai.ins.lagging', vars: lag })
  if (moodAvg !== null && moodAvg <= MOOD_LOW) insights.push({ kind: 'mood', severity: 'warn', key: 'ai.ins.moodLow', vars: { avg: moodAvg } })
  if (moodAvg !== null && moodAvg >= MOOD_GOOD) insights.push({ kind: 'mood', severity: 'good', key: 'ai.ins.moodGood', vars: { avg: moodAvg } })
  if (habits.length && h.rate >= HABITS_GOOD_RATE) insights.push({ kind: 'habits', severity: 'good', key: 'ai.ins.habitsGood', vars: { pct: Math.round(h.rate * 100) } })
  if (habits.length && h.rate < HABITS_LOW_RATE) insights.push({ kind: 'habits', severity: 'warn', key: 'ai.ins.habitsLow', vars: { pct: Math.round(h.rate * 100) } })
  if (t.done >= PRODUCTIVE_TASKS) insights.push({ kind: 'progress', severity: 'good', key: 'ai.ins.productive', vars: { n: t.done } })
  mandalas.forEach((m) => {
    const s = mandalaStats(m)
    if (s.actions > 0) insights.push({ kind: 'progress', severity: 'info', key: 'ai.ins.mandala', vars: { title: m.title, pct: s.progress, done: s.actionsDone, total: s.actions } })
    const pace = paceInsight(m, today)
    if (pace) insights.push(pace)
  })
  insights.push(next
    ? { kind: 'next', severity: 'info', key: 'ai.ins.nextAction', vars: { action: next } }
    : { kind: 'next', severity: 'info', key: 'ai.ins.start', vars: {} })

  return {
    period: { from, to },
    stats: {
      tasksDone: t.done,
      tasksOverdue: t.overdue,
      habitCheckins: h.checkins,
      habitRate: round1(h.rate),
      moodAvg,
    },
    insights,
  }
}
