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
//       actions: [{ en, kg, ru }],       // exactly 8 concrete actions
//     },
//   ],
// }
//
// Coach intent:
// { id, patterns: { en: [], kg: [], ru: [] }, answers: { en: [], kg: [], ru: [] }, insight?: string }

export const LANGS = ['en', 'kg', 'ru']
export const SLOTS = 8
export const INSIGHT_KINDS = ['progress', 'lagging', 'overdue', 'mood', 'habits', 'next', 'pace', 'rewards']
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
    return errors
  }
  domain.directions.forEach((dir, d) => {
    const p = `directions[${d}]`
    checkLocalized(dir?.title, `${p}.title`, errors)
    const ms = dir?.milestones ?? []
    if (!Array.isArray(ms) || ms.length > MAX_MILESTONES) errors.push(`${p}.milestones: 0-${MAX_MILESTONES} items`)
    else ms.forEach((m, i) => checkLocalized(m, `${p}.milestones[${i}]`, errors))
    if (!Array.isArray(dir?.actions) || dir.actions.length !== SLOTS) {
      errors.push(`${p}.actions: exactly ${SLOTS} required`)
      return
    }
    dir.actions.forEach((a, i) => checkLocalized(a, `${p}.actions[${i}]`, errors))
  })
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
