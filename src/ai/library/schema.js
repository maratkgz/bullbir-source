// Format of the assistant's knowledge library. Used by the library test, the
// runtime loader (Firestore entries) and the admin import, so bad data never reaches users.
//
// Domain (one sphere of life, e.g. health):
// {
//   id: 'health',                      // a-z, 0-9, '-' ; unique
//   icon: '💪',
//   title:    { en, kg, ru },
//   keywords: { en: [], kg: [], ru: [] }, // words that point to this domain;
//                                         // prefix "!" marks a decisive word (double weight)
//   directions: [                        // exactly 8
//     {
//       title: { en, kg, ru },
//       milestones: [{ en, kg, ru }],    // 0..4 intermediate goals for the direction
//       kind?: 'direct'|'support'|'character',
//       actions: [{                      // exactly 8 concrete actions
//         en, kg, ru,
//         type?: 'habit'|'milestone'|'quality',
//         freq?: 'daily'|'3w'|'weekly',  // habits only
//         minutes?: 5..120,              // time for one session
//         easy?: { en, kg, ru },         // lighter variant offered on "too hard"
//         steps?: [{ en, kg, ru, minutes: 5..240 }], // 5..12, milestones only
//       }],
//     },
//   ],
//   spares?: [Direction],              // 0..8 extra directions (same rules) for "replace direction"
// }
//
// Coach intent:
// { id, patterns: { en: [], kg: [], ru: [] }, answers: { en: [], kg: [], ru: [] }, insight?: string }

export const LANGS = ['en', 'kg', 'ru']
export const SLOTS = 8
export const INSIGHT_KINDS = ['progress', 'lagging', 'overdue', 'mood', 'habits', 'next', 'pace', 'rewards']
export const ITEM_TYPES = ['habit', 'milestone', 'quality']
export const FREQS = ['daily', '3w', 'weekly']
export const DIRECTION_KINDS = ['direct', 'support', 'character']
export const ITEM_MINUTES = { min: 5, max: 120 }
export const STEP_COUNT = { min: 5, max: 12 }
export const STEP_MINUTES = { min: 5, max: 240 } // a long step is split by the breakdown
export const MAX_SPARES = 8
const MAX_TEXT = 120
const MAX_MILESTONES = 4
const ID_RE = /^[a-z0-9-]{2,40}$/

function checkLocalized(value, path, errors, { max = MAX_TEXT } = {}) {
  if (!value || typeof value !== 'object') {
    errors.push(`${path}: expected { en, kg, ru }`)
    return
  }
  LANGS.forEach((l) => {
    const s = value[l]
    if (typeof s !== 'string' || !s.trim()) errors.push(`${path}.${l}: missing text`)
    else if (s.length > max) errors.push(`${path}.${l}: longer than ${max} characters`)
  })
}

function checkLocalizedList(value, path, errors, { min = 1, max = MAX_TEXT } = {}) {
  if (!value || typeof value !== 'object') {
    errors.push(`${path}: expected { en: [], kg: [], ru: [] }`)
    return
  }
  LANGS.forEach((l) => {
    const list = value[l]
    if (!Array.isArray(list) || list.length < min) {
      errors.push(`${path}.${l}: needs at least ${min} item(s)`)
      return
    }
    list.forEach((s, i) => {
      if (typeof s !== 'string' || !s.trim()) errors.push(`${path}.${l}[${i}]: empty`)
      else if (s.length > max) errors.push(`${path}.${l}[${i}]: longer than ${max} characters`)
    })
  })
}

const isMinutes = (n) => Number.isInteger(n) && n >= ITEM_MINUTES.min && n <= ITEM_MINUTES.max

function checkSteps(steps, path, errors) {
  if (!Array.isArray(steps) || steps.length < STEP_COUNT.min || steps.length > STEP_COUNT.max) {
    errors.push(`${path}: ${STEP_COUNT.min}-${STEP_COUNT.max} items`)
    return
  }
  steps.forEach((s, i) => {
    checkLocalized(s, `${path}[${i}]`, errors)
    const m = s?.minutes
    if (!Number.isInteger(m) || m < STEP_MINUTES.min || m > STEP_MINUTES.max) {
      errors.push(`${path}[${i}].minutes: integer ${STEP_MINUTES.min}-${STEP_MINUTES.max}`)
    }
  })
}

/** Optional typing of one action: type, freq, minutes, easy variant, milestone steps. */
function checkAction(a, path, errors) {
  checkLocalized(a, path, errors)
  if (!a || typeof a !== 'object') return
  if (a.type !== undefined && !ITEM_TYPES.includes(a.type)) errors.push(`${path}.type: one of ${ITEM_TYPES.join(', ')}`)
  if (a.freq !== undefined) {
    if (!FREQS.includes(a.freq)) errors.push(`${path}.freq: one of ${FREQS.join(', ')}`)
    else if (a.type !== undefined && a.type !== 'habit') errors.push(`${path}.freq: only for habits`)
  }
  if (a.minutes !== undefined && !isMinutes(a.minutes)) errors.push(`${path}.minutes: integer ${ITEM_MINUTES.min}-${ITEM_MINUTES.max}`)
  if (a.easy !== undefined) checkLocalized(a.easy, `${path}.easy`, errors)
  if (a.steps !== undefined) {
    if (a.type !== 'milestone') errors.push(`${path}.steps: only for type "milestone"`)
    else checkSteps(a.steps, `${path}.steps`, errors)
  }
}

function checkDirection(dir, p, errors) {
  checkLocalized(dir?.title, `${p}.title`, errors)
  if (dir?.kind !== undefined && !DIRECTION_KINDS.includes(dir.kind)) {
    errors.push(`${p}.kind: one of ${DIRECTION_KINDS.join(', ')}`)
  }
  const ms = dir?.milestones ?? []
  if (!Array.isArray(ms) || ms.length > MAX_MILESTONES) errors.push(`${p}.milestones: 0-${MAX_MILESTONES} items`)
  else ms.forEach((m, i) => checkLocalized(m, `${p}.milestones[${i}]`, errors))
  if (!Array.isArray(dir?.actions) || dir.actions.length !== SLOTS) {
    errors.push(`${p}.actions: exactly ${SLOTS} required`)
    return
  }
  dir.actions.forEach((a, i) => checkAction(a, `${p}.actions[${i}]`, errors))
}

/** @returns {string[]} human-readable problems; empty when the domain is valid. */
export function validateDomain(domain) {
  const errors = []
  if (!domain || typeof domain !== 'object') return ['domain: not an object']
  if (!ID_RE.test(domain.id || '')) errors.push('id: use 2-40 chars a-z, 0-9, -')
  if (typeof domain.icon !== 'string' || !domain.icon) errors.push('icon: missing')
  checkLocalized(domain.title, 'title', errors)
  checkLocalizedList(domain.keywords, 'keywords', errors, { min: 1, max: 40 })
  if (!Array.isArray(domain.directions) || domain.directions.length !== SLOTS) {
    errors.push(`directions: exactly ${SLOTS} required`)
  } else {
    domain.directions.forEach((dir, d) => checkDirection(dir, `directions[${d}]`, errors))
  }
  if (domain.spares !== undefined) {
    if (!Array.isArray(domain.spares) || domain.spares.length > MAX_SPARES) errors.push(`spares: 0-${MAX_SPARES} items`)
    else domain.spares.forEach((dir, k) => checkDirection(dir, `spares[${k}]`, errors))
  }
  return errors
}

/** @returns {string[]} problems in one coach intent. */
export function validateIntent(intent) {
  const errors = []
  if (!intent || typeof intent !== 'object') return ['intent: not an object']
  if (!ID_RE.test(intent.id || '')) errors.push('id: use 2-40 chars a-z, 0-9, -')
  checkLocalizedList(intent.patterns, 'patterns', errors, { min: 1, max: 200 })
  checkLocalizedList(intent.answers, 'answers', errors, { min: 1, max: 600 })
  if (intent.insight !== undefined && !INSIGHT_KINDS.includes(intent.insight)) {
    errors.push(`insight: one of ${INSIGHT_KINDS.join(', ')}`)
  }
  return errors
}

/** Picks the text for `lang`, falling back to ru → en. */
export function pick(localized, lang) {
  if (!localized) return ''
  return localized[lang] || localized.ru || localized.en || ''
}
