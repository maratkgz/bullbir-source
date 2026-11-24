// Retrieval-based coach: matches the user's message to an intent from the library and
// answers from it, optionally appending live facts about the user's own progress.
import { normalize, wordSimilarity } from './text'

// Unlike goal classification, chat phrases rely on small words ("хочу стать", "how am I"),
// so the coach keeps stop words and only drops one-letter tokens.
const tokenize = (text) => normalize(text).split(' ').filter((w) => w.length >= 2)
import { LANGS } from '../library/schema'

export const FALLBACK_INTENT_ID = 'fallback'
const WORD_MATCH = 0.6
const INTENT_MATCH = 0.6
const SAME_LANG_BONUS = 0.05

const SPECIFICITY_BONUS = 0.02 // per matched word: longer matching patterns win ties

/** Share of the pattern's words found (fuzzily) in the message, plus a tie-break bonus. */
function coverage(patternTokens, messageTokens) {
  if (!patternTokens.length || !messageTokens.length) return 0
  let hit = 0
  let matched = 0
  patternTokens.forEach((p) => {
    const best = Math.max(...messageTokens.map((m) => wordSimilarity(p, m)))
    if (best >= WORD_MATCH) { hit += best; matched += 1 }
  })
  return hit / patternTokens.length + matched * SPECIFICITY_BONUS
}

function stableIndex(text, length) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return length ? h % length : 0
}

function bestIntent(message, intents, lang) {
  const msgTokens = tokenize(message)
  let best = { intent: null, score: 0 }
  intents.forEach((intent) => {
    if (intent.id === FALLBACK_INTENT_ID) return
    LANGS.forEach((l) => (intent.patterns?.[l] || []).forEach((pattern) => {
      const score = coverage(tokenize(pattern), msgTokens) + (l === lang ? SAME_LANG_BONUS : 0)
      if (score > best.score) best = { intent, score }
    }))
  })
  return best
}

/**
 * @param {string} message
 * @param {object[]} intents   validated coach intents (one with id 'fallback' recommended)
 * @param {{ lang: 'en'|'kg'|'ru', describeInsight?: (kind: string) => string }} options
 * @returns {{ intentId: string, text: string, confidence: number }}
 */
export function answer(message, intents, { lang, describeInsight } = {}) {
  const { intent, score } = bestIntent(message, intents, lang)
  const chosen = intent && score >= INTENT_MATCH
    ? intent
    : intents.find((i) => i.id === FALLBACK_INTENT_ID)

  if (!chosen) return { intentId: FALLBACK_INTENT_ID, text: '', confidence: 0 }
  const variants = chosen.answers?.[lang]?.length ? chosen.answers[lang] : chosen.answers?.ru || chosen.answers?.en || []
  let text = variants[stableIndex(message, variants.length)] || ''
  if (chosen.insight && describeInsight) {
    const live = describeInsight(chosen.insight)
    if (live) text = `${text}\n\n${live}`
  }
  return { intentId: chosen.id, text, confidence: chosen === intent ? Math.min(score, 1) : 0 }
}
