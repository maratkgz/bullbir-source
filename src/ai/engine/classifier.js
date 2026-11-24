// Goal → domain classifier. Keyword matching with fuzzy word similarity, IDF weighting
// (keywords shared by many domains count less) and per-user learned feedback.
import { tokenize, stem, wordSimilarity } from './text'
import { LANGS } from '../library/schema'

export const FALLBACK_DOMAIN_ID = 'universal'
const MATCH_THRESHOLD = 0.6     // word similarity below this is ignored
const MIN_SCORE = 0.5           // below this the goal is "unknown" → universal template
const FEEDBACK_WEIGHT = 1.5     // weight of one remembered user choice per word
const MAX_FEEDBACK_PER_WORD = 5

const STRONG_PREFIX = '!'      // "!преподаватель" in the library = decisive keyword
const STRONG_WEIGHT = 2
const WEAK_WEIGHT = 0.4
// Generic learning/goal words: they say "a goal" but not *which* sphere.
const WEAK_WORDS = new Set([
  'learn', 'study', 'read', 'language', 'become',
  'учить', 'выучить', 'научиться', 'изучить', 'учеба', 'читать', 'язык', 'языка', 'языку',
  'үйрөнүү', 'үйрөнүп', 'окуу', 'тил', 'тилин', 'тили', 'болуу',
])

function domainTokens(domain) {
  const weights = new Map()
  LANGS.forEach((l) => (domain.keywords?.[l] || []).forEach((kw) => {
    const strong = kw.startsWith(STRONG_PREFIX)
    tokenize(kw).forEach((t) => {
      const w = strong ? STRONG_WEIGHT : WEAK_WORDS.has(t) ? WEAK_WEIGHT : 1
      weights.set(t, Math.max(weights.get(t) || 0, w))
    })
  }))
  return [...weights].map(([token, weight]) => ({ token, weight }))
}

function buildIndex(domains) {
  const entries = domains.map((d) => ({ id: d.id, tokens: domainTokens(d) }))
  const df = new Map()
  entries.forEach((e) => new Set(e.tokens.map((t) => stem(t.token))).forEach((s) => df.set(s, (df.get(s) || 0) + 1)))
  const n = Math.max(entries.length, 1)
  const idf = (token) => Math.log(1 + n / (df.get(stem(token)) || 1))
  return { entries, idf }
}

function keywordScore(goalTokens, entry, idf) {
  let score = 0
  goalTokens.forEach((g) => {
    let best = 0
    entry.tokens.forEach(({ token, weight }) => {
      const s = wordSimilarity(g, token)
      if (s >= MATCH_THRESHOLD) best = Math.max(best, s * weight * idf(token))
    })
    score += best
  })
  return score
}

function feedbackScore(goalTokens, domainId, feedback) {
  if (!feedback) return 0
  return goalTokens.reduce((sum, g) => {
    const count = Math.min(feedback[stem(g)]?.[domainId] || 0, MAX_FEEDBACK_PER_WORD)
    return sum + count * FEEDBACK_WEIGHT
  }, 0)
}

/**
 * Ranks domains for a goal text.
 * @param {string} goal
 * @param {Array<{id: string, keywords: object}>} domains
 * @param {{ feedback?: Record<string, Record<string, number>> }} [options]
 * @returns {Array<{ id: string, score: number, confidence: number, isFallback: boolean }>}
 */
export function classifyGoal(goal, domains, { feedback } = {}) {
  const goalTokens = tokenize(goal)
  const { entries, idf } = buildIndex(domains)
  const scored = entries.map((e) => ({
    id: e.id,
    score: keywordScore(goalTokens, e, idf) + feedbackScore(goalTokens, e.id, feedback),
  }))

  const specific = scored.filter((s) => s.id !== FALLBACK_DOMAIN_ID)
  const topSpecific = Math.max(0, ...specific.map((s) => s.score))
  const hasFallback = scored.some((s) => s.id === FALLBACK_DOMAIN_ID)

  if (topSpecific < MIN_SCORE && hasFallback) {
    return [
      { id: FALLBACK_DOMAIN_ID, score: 0, confidence: 1, isFallback: true },
      ...specific.map((s) => ({ ...s, confidence: 0, isFallback: false })),
    ]
  }

  const total = scored.reduce((sum, s) => sum + s.score, 0) || 1
  return scored
    .map((s) => ({ ...s, confidence: s.score / total, isFallback: false }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Remembers that the user picked `domainId` for this goal (immutable update).
 * Stored per user, so the assistant adapts to how each person phrases goals.
 */
export function learnFromChoice(feedback, goal, domainId) {
  const next = { ...(feedback || {}) }
  new Set(tokenize(goal).map(stem)).forEach((s) => {
    const row = { ...(next[s] || {}) }
    row[domainId] = Math.min((row[domainId] || 0) + 1, MAX_FEEDBACK_PER_WORD)
    next[s] = row
  })
  return next
}
