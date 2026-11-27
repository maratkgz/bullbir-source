// Coach interview: a small deterministic questionnaire before building a mandala.
// The UI shows `t(key)` for each step; answers live in one plain object.
import { normalize } from './text'
import { classifyGoal, FALLBACK_DOMAIN_ID } from './classifier'

// Short on purpose: three questions are enough to build the table; the rest stays editable.
export const INTERVIEW_STEPS = ['goal', 'why', 'minutes']
export const MINUTES_RANGE = { min: 5, max: 240, fallback: 30 }

const MIN_WORDS = 2
const VAGUE_ANSWERS = new Set([
  'не знаю', 'незнаю', 'хз', 'без понятия', 'ничего', 'не помню', 'всё', 'все', 'пофиг', 'нет',
  'idk', 'i don t know', 'dont know', 'don t know', 'no idea', 'nothing', 'whatever', 'no',
  'билбейм', 'билбеймин', 'эч нерсе', 'жок', 'эсимде жок',
].map(normalize))

const HALF_HOUR = ['полчаса', 'пол часа', 'half an hour', 'half hour', 'жарым саат']
const HOUR_AND_HALF = ['полтора часа', 'полтора', 'an hour and a half', 'бир жарым саат']
const ONE_HOUR = ['час', 'один час', 'an hour', 'one hour', 'hour', 'бир саат', 'саат']

const HOURS_RE = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h(?![a-z])|час\S*|ч(?![а-яё])|саат\S*)/u
const MINS_RE = /(\d+)\s*(?:minutes?|mins?|m(?![a-z])|мин\S*|м(?![а-яё])|мүнөт\S*|мүн\S*)/u
const NUMBER_RE = /(\d+(?:\.\d+)?)/

const clampMinutes = (n) => Math.min(Math.max(Math.round(n), MINUTES_RANGE.min), MINUTES_RANGE.max)

/** Minutes from free text, or null when no duration is recognised. */
export function parseMinutesStrict(text) {
  const raw = String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/,/g, '.').trim()
  if (!raw) return null
  const hours = HOURS_RE.exec(raw)
  const mins = MINS_RE.exec(raw)
  if (hours || mins) return clampMinutes((hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0))
  const norm = normalize(raw)
  const has = (list) => list.some((p) => ` ${norm} `.includes(` ${normalize(p)} `))
  if (has(HOUR_AND_HALF)) return 90
  if (has(HALF_HOUR)) return 30
  const num = NUMBER_RE.exec(raw)
  if (num) return clampMinutes(Number(num[1]))
  if (has(ONE_HOUR)) return 60
  return null
}

/**
 * "30", "30 мин", "1 час", "полчаса", "1.5 hours", "1 саат", "жарым саат" → minutes,
 * clamped to 5..240; unknown → 30.
 */
export function parseMinutes(text) {
  const n = parseMinutesStrict(text)
  return n === null ? MINUTES_RANGE.fallback : n
}

/** True when an answer is too short or a known "don't know" phrase. */
export function isVagueAnswer(step, text) {
  const norm = normalize(text)
  if (!norm) return true
  if (step === 'minutes') return parseMinutesStrict(text) === null
  if (VAGUE_ANSWERS.has(norm)) return true
  return norm.split(' ').length < MIN_WORDS
}

const answerOf = (answers, step) => String(answers?.[step] ?? '').trim()

/**
 * Returns a NEW answers object with `text` stored for `step`. Answering a step that already
 * had an answer counts as the clarification, so the coach asks again at most once.
 */
export function applyAnswer(answers, step, text) {
  const prev = answers || {}
  if (!INTERVIEW_STEPS.includes(step)) return { ...prev }
  const value = String(text ?? '').trim()
  const answeredBefore = answerOf(prev, step) !== ''
  const clarified = answeredBefore ? { ...(prev._clarified || {}), [step]: true } : prev._clarified
  const next = { ...prev, [step]: value || answerOf(prev, step) }
  return clarified ? { ...next, _clarified: clarified } : next
}

function summarize(answers, domains) {
  const goal = answerOf(answers, 'goal')
  const ranked = domains?.length ? classifyGoal(goal, domains) : []
  return {
    life: answerOf(answers, 'life'),
    goal,
    why: answerOf(answers, 'why'),
    has: answerOf(answers, 'has'),
    failures: answerOf(answers, 'failures'),
    obstacles: answerOf(answers, 'obstacles'),
    minutesPerDay: parseMinutes(answers.minutes),
    sphere: ranked[0]?.id || FALLBACK_DOMAIN_ID,
  }
}

/**
 * @param {Record<string, string> & { _clarified?: Record<string, true> }} answers
 * @param {{ domains?: object[] }} [options] library domains for the `sphere` guess
 * @returns {{ done: false, step: string, key: string, clarify?: true }
 *   | { done: true, summary: { life, goal, why, has, failures, obstacles, minutesPerDay: number, sphere: string } }}
 */
export function nextStep(answers, { domains = [] } = {}) {
  const a = answers || {}
  for (const step of INTERVIEW_STEPS) {
    const value = answerOf(a, step)
    if (!value) return { done: false, step, key: `ai.iv.q.${step}` }
    if (isVagueAnswer(step, value) && !a._clarified?.[step]) {
      return { done: false, step, key: `ai.iv.clarify.${step}`, clarify: true }
    }
  }
  return { done: true, summary: summarize(a, domains) }
}
