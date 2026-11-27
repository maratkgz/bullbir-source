// Pure helpers for the Dashboard (home) screen — no React, no Firestore.
import { toDate, toDateKey } from '../../../utils/format'

/** Translation key for the time-of-day greeting. */
export function greetingKey(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return 'dash.greetingMorning'
  if (h < 18) return 'dash.greetingAfternoon'
  return 'dash.greetingEvening'
}

/** First word of a display name ("Марат Асанов" → "Марат"); '' for anything else. */
export function firstWord(name) {
  return typeof name === 'string' ? name.trim().split(/\s+/)[0] || '' : ''
}

/** Name to greet: the profile's first name, else the first word of the display name. */
export function greetingName(profile, user) {
  return (
    firstWord(profile?.firstName) ||
    firstWord(profile?.displayName) ||
    firstWord(user?.displayName)
  )
}

/** Consecutive days (ending today) with at least one task marked done. */
export function calcStreak(tasks) {
  const doneDays = new Set(
    tasks
      .filter((t) => t.status === 'done' && toDate(t.updatedAt))
      .map((t) => toDateKey(toDate(t.updatedAt))),
  )
  let streak = 0
  const d = new Date()
  while (doneDays.has(toDateKey(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}
