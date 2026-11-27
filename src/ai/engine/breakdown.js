// Breaks a milestone (one-off result) into 5..12 small steps that each fit the user's day.
import stepsLibrary from '../library/steps.json'
import { pick, LANGS, STEP_COUNT } from '../library/schema'
import { normalize } from './text'
import { resolveSrc } from './mandalaGenerator'

export const GENERIC_SEQUENCE_ID = 'generic'
const MIN_DAY_MINUTES = 5
const DEFAULT_DAY_MINUTES = 30

/** Picks the generic sequence whose keywords (word prefixes, any language) match the text. */
export function pickSequence(text, sequences = stepsLibrary.sequences) {
  const words = normalize(text).split(' ').filter(Boolean)
  const matches = (kw) => {
    const k = normalize(kw)
    return k && words.some((w) => w.startsWith(k))
  }
  const found = sequences.find((s) => s.id !== GENERIC_SEQUENCE_ID
    && LANGS.some((l) => (s.keywords?.[l] || []).some(matches)))
  return found || sequences.find((s) => s.id === GENERIC_SEQUENCE_ID) || sequences[0]
}

/**
 * Splits steps longer than `cap` minutes into parts "(1/2)", "(2/2)"… while keeping the total
 * number of steps ≤ STEP_COUNT.max. A step that still cannot fit is clamped to `cap`
 * (the user does a first session of it that day).
 */
export function fitSteps(steps, cap) {
  let spare = Math.max(STEP_COUNT.max - steps.length, 0)
  return steps.slice(0, STEP_COUNT.max).flatMap((s) => {
    const wanted = Math.ceil(s.minutes / cap)
    const parts = Math.max(Math.min(wanted, 1 + spare), 1)
    spare -= parts - 1
    if (parts === 1) return [{ title: s.title, minutes: Math.min(s.minutes, cap) }]
    const each = Math.min(Math.ceil(s.minutes / parts), cap)
    return Array.from({ length: parts }, (_, k) => ({ title: `${s.title} (${k + 1}/${parts})`, minutes: each }))
  })
}

/**
 * @param {{ text: string, src?: string }} cell milestone cell of a mandala
 * @param {{ minutesPerDay?: number, lang?: 'en'|'kg'|'ru', domains?: object[] }} [options]
 * @returns {{ steps: Array<{ title: string, minutes: number }> }} 5..12 steps, each ≤ minutesPerDay
 */
export function breakdownMilestone(cell, { minutesPerDay = DEFAULT_DAY_MINUTES, lang = 'ru', domains = [] } = {}) {
  const cap = Math.max(Math.round(Number(minutesPerDay) || DEFAULT_DAY_MINUTES), MIN_DAY_MINUTES)
  const tplSteps = resolveSrc(domains, cell?.src)?.action?.steps
  const source = Array.isArray(tplSteps) && tplSteps.length >= STEP_COUNT.min
    ? tplSteps
    : pickSequence(cell?.text || '').steps
  const steps = source.map((s) => ({ title: pick(s, lang), minutes: Math.max(Math.round(s.minutes) || cap, 1) }))
  return { steps: fitSteps(steps, cap) }
}
