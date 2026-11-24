// Local-time date helpers. `new Date('YYYY-MM-DD')` is parsed as UTC, which shifts the
// day in UTC+ time zones (Bishkek is UTC+6) — always go through these instead.
import { toDate, toDateKey } from '../../utils/format'

export const DAY_MS = 24 * 60 * 60 * 1000

/** 'YYYY-MM-DD' → local midnight Date; other values via toDate(). */
export function parseDay(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return toDate(value)
}

export function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export { toDateKey }
