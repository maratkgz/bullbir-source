// Pace ("tempo") tracking: how fast the user really completes mandala actions versus
// how fast they must go to reach the goal by its deadline.
import { parseDay, addDays, toDateKey, DAY_MS } from './dates'

const RATE_WINDOW_WEEKS = 4
const AHEAD = 1.1
const ON_TRACK = 0.9
const round1 = (n) => Math.round(n * 10) / 10

/**
 * @param {object} mandala normalized mandala (center.deadline optional, actions with doneAt)
 * @param {Date} [today]
 * @returns {{ status: 'done'|'not-started'|'no-deadline'|'ahead'|'on-track'|'behind',
 *   weeklyRate: number, requiredRate: number|null, remaining: number, total: number,
 *   weeksLeft: number|null, projectedDate: string|null, delayWeeks: number|null }}
 */
export function mandalaPace(mandala, today = new Date()) {
  const actions = mandala.directions.flatMap((d) => d.actions).filter((a) => a.text.trim())
  const total = actions.length
  const doneCount = actions.filter((a) => a.done).length
  const remaining = total - doneCount

  const windowStart = toDateKey(addDays(today, -RATE_WINDOW_WEEKS * 7))
  const recent = actions.filter((a) => a.done && a.doneAt && a.doneAt > windowStart).length
  const weeklyRate = round1(recent / RATE_WINDOW_WEEKS)

  const deadline = mandala.center.deadline ? parseDay(mandala.center.deadline) : null
  const weeksLeft = deadline ? Math.max((deadline - today) / (7 * DAY_MS), 0) : null
  const projectedDate = weeklyRate > 0 && remaining > 0
    ? toDateKey(addDays(today, Math.ceil((remaining / weeklyRate) * 7)))
    : null

  const base = { weeklyRate, remaining, total, weeksLeft: weeksLeft === null ? null : round1(weeksLeft), projectedDate }

  if (total > 0 && remaining === 0) return { ...base, status: 'done', requiredRate: null, delayWeeks: null }
  if (doneCount === 0 && recent === 0) return { ...base, status: 'not-started', requiredRate: null, delayWeeks: null }
  if (!deadline) return { ...base, status: 'no-deadline', requiredRate: null, delayWeeks: null }

  const requiredRate = weeksLeft > 0 ? round1(remaining / weeksLeft) : remaining
  const delayWeeks = weeklyRate > 0 ? Math.max(Math.ceil(remaining / weeklyRate - weeksLeft), 0) : null
  let status = 'behind'
  if (weeklyRate >= requiredRate * AHEAD) status = 'ahead'
  else if (weeklyRate >= requiredRate * ON_TRACK) status = 'on-track'
  return { ...base, status, requiredRate, delayWeeks }
}
