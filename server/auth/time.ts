// Firestore returns Timestamps; we work in epoch milliseconds and store Dates (→ Timestamps, which
// the Firestore TTL policy needs for automatic cleanup).
import { Timestamp } from 'firebase-admin/firestore'

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export function toMs(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return null
}

export function toIso(value: unknown): string | null {
  const ms = toMs(value)
  return ms === null ? null : new Date(ms).toISOString()
}

/** Injectable clock so tests can move time. */
let clock: () => number = Date.now

export function now(): number {
  return clock()
}

export function setClockForTests(next: (() => number) | undefined): void {
  clock = next ?? Date.now
}
