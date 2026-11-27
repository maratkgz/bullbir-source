// Retrieval-based coach: matches the user's message to an intent from the library and
// answers from it, optionally appending live facts about the user's own progress.
// Multi-turn behaviour (follow-ups, variant rotation, suggestions) lives in ./dialog.
import { normalize, wordSimilarity } from './text'
import { LANGS } from '../library/schema'
import {
  classifyShortReply, resolveFollowUp, pickVariant, personalize, buildSuggestions,
  sanitizeContext, nextContext,
} from './dialog'

export const FALLBACK_INTENT_ID = 'fallback'
const ACK_INTENT_ID = 'ack'
const UNSURE_INTENT_ID = 'unsure'
const LATER_INTENT_ID = 'later'

const WORD_MATCH = 0.6
const SHORT_WORD_MATCH = 0.75 // words of ≤ 4 letters: "дела" must not match "делать"
const SHORT_WORD = 4
const STRICT_WORD_MATCH = 0.9 // priority (safety) intents: same word or same stem only
const INTENT_MATCH = 0.6
const SAME_LANG_BONUS = 0.05
const SPECIFICITY_BONUS = 0.02 // per matched word: longer matching patterns win ties
const MAX_GAP = 1 // strict matching: extra words allowed between two pattern words

// Unlike goal classification, chat phrases rely on small words ("хочу стать", "how am I"),
// so the coach keeps stop words and only drops one-letter tokens.
const tokenize = (text) => normalize(text).split(' ').filter((w) => w.length >= 2)

const STEM_SCORE = 0.9 // what wordSimilarity returns for a shared 5-letter stem
const MAX_STEM_LENGTH_GAP = 3
const LONG_PREFIX = 6

function commonPrefix(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return i
}

/**
 * wordSimilarity, minus stem false friends: "прогресс" and "программировать" share the stem
 * "прогр" but are different words, so a stem match needs similar length or a longer prefix.
 */
function similarity(a, b) {
  const s = wordSimilarity(a, b)
  if (s !== STEM_SCORE) return s
  const close = Math.abs(a.length - b.length) <= MAX_STEM_LENGTH_GAP || commonPrefix(a, b) >= LONG_PREFIX
  return close ? s : 0
}

function wordThreshold(word, strict) {
  if (strict) return STRICT_WORD_MATCH
  return word.length <= SHORT_WORD ? SHORT_WORD_MATCH : WORD_MATCH
}

/** Share of the pattern's words found (fuzzily) in the message, plus a tie-break bonus. */
function coverage(patternTokens, messageTokens) {
  if (!patternTokens.length || !messageTokens.length) return 0
  let hit = 0
  let matched = 0
  patternTokens.forEach((p) => {
    const best = Math.max(...messageTokens.map((m) => similarity(p, m)))
    if (best >= wordThreshold(p, false)) { hit += best; matched += 1 }
  })
  return hit / patternTokens.length + matched * SPECIFICITY_BONUS
}

/**
 * Strict match for safety intents: every pattern word, in order, each with the same word/stem,
 * at most MAX_GAP other words between them ("не хочу жить", "хочу очень умереть").
 * Returns 1 + bonus on a match, else 0.
 */
function strictCoverage(patternTokens, messageTokens) {
  if (!patternTokens.length) return 0
  const same = (p, m) => similarity(p, m) >= wordThreshold(p, true)
  for (let start = 0; start < messageTokens.length; start++) {
    if (!same(patternTokens[0], messageTokens[start])) continue
    let pos = start
    const ok = patternTokens.slice(1).every((p) => {
      const window = messageTokens.slice(pos + 1, pos + 2 + MAX_GAP)
      const at = window.findIndex((m) => same(p, m))
      if (at < 0) return false
      pos += at + 1
      return true
    })
    if (ok) return 1 + patternTokens.length * SPECIFICITY_BONUS
  }
  return 0
}

const match = (patternTokens, messageTokens, strict) => (strict
  ? strictCoverage(patternTokens, messageTokens)
  : coverage(patternTokens, messageTokens))

const isPriority = (intent) => Number(intent.priority) > 0

/** True when the message contains one of the intent's `exclude` phrases (e.g. "со смеху"). */
function isExcluded(intent, msgTokens) {
  return LANGS.some((l) => (intent.exclude?.[l] || [])
    .some((phrase) => strictCoverage(tokenize(phrase), msgTokens) > 0))
}

function scoreIntent(intent, msgTokens, lang) {
  if (isExcluded(intent, msgTokens)) return 0
  const strict = isPriority(intent)
  let best = 0
  LANGS.forEach((l) => (intent.patterns?.[l] || []).forEach((pattern) => {
    const raw = match(tokenize(pattern), msgTokens, strict)
    const score = raw > 0 ? raw + (l === lang ? SAME_LANG_BONUS : 0) : 0
    if (score > best) best = score
  }))
  return best
}

/**
 * Best intent for the message. Priority (safety) intents are checked first with strict word
 * matching and win over everything else; the highest `priority` wins among them.
 */
function bestIntent(message, intents, lang) {
  const msgTokens = tokenize(message)
  const candidates = intents.filter((i) => i.id !== FALLBACK_INTENT_ID)
  const urgent = candidates
    .filter(isPriority)
    .map((intent) => ({ intent, score: scoreIntent(intent, msgTokens, lang) }))
    .filter((c) => c.score >= INTENT_MATCH)
    .sort((a, b) => Number(b.intent.priority) - Number(a.intent.priority) || b.score - a.score)
  if (urgent.length) return urgent[0]
  let best = { intent: null, score: 0 }
  candidates.filter((i) => !isPriority(i)).forEach((intent) => {
    const score = scoreIntent(intent, msgTokens, lang)
    if (score > best.score) best = { intent, score }
  })
  return best
}

const findIntent = (intents, id) => intents.find((i) => i.id === id) || null

/** Intent for a bare "да"/"нет"/"не знаю" that answers nothing in particular. */
function shortReplyIntent(reply, intents) {
  if (reply === 'unsure') return findIntent(intents, UNSURE_INTENT_ID)
  if (reply === 'no') return findIntent(intents, LATER_INTENT_ID)
  return reply === 'yes' ? findIntent(intents, ACK_INTENT_ID) : null
}

/** Decides which intent answers the message: safety → follow-up → match → short reply → fallback. */
function chooseIntent(message, intents, lang, context) {
  const { intent, score } = bestIntent(message, intents, lang)
  if (intent && isPriority(intent)) return { chosen: intent, confidence: Math.min(score, 1) }
  const reply = classifyShortReply(message)
  const followed = resolveFollowUp(reply, context, intents)
  if (followed) return { chosen: followed, confidence: 1 }
  if (intent && score >= INTENT_MATCH) return { chosen: intent, confidence: Math.min(score, 1) }
  const short = shortReplyIntent(reply, intents)
  if (short) return { chosen: short, confidence: INTENT_MATCH }
  return { chosen: findIntent(intents, FALLBACK_INTENT_ID), confidence: 0 }
}

/** Builds the reply object for a chosen intent (shared by answer() and answerIntent()). */
function respond(chosen, confidence, seed, intents, options) {
  const { lang, describeInsight, name } = options
  const context = sanitizeContext(options.context)
  const variant = pickVariant(chosen, lang, seed, context)
  let text = personalize(variant.text, name)
  if (chosen.insight && describeInsight) {
    const live = describeInsight(chosen.insight)
    if (live) text = `${text}\n\n${live}`
  }
  return {
    intentId: chosen.id,
    text,
    confidence,
    context: nextContext(context, chosen, variant.index),
    suggestions: buildSuggestions(chosen, intents, lang),
  }
}

function emptyReply(options) {
  const context = sanitizeContext(options.context)
  return {
    intentId: FALLBACK_INTENT_ID,
    text: '',
    confidence: 0,
    context: { ...(context || {}), lastIntentId: FALLBACK_INTENT_ID, followUp: null, turn: (context?.turn || 0) + 1 },
    suggestions: [],
  }
}

/**
 * @typedef {{ lastIntentId: string|null, topic: string|null, followUp: string|null, turn: number, lastVariant: number }} CoachContext
 * @typedef {{ id: string, label: string }} Suggestion
 * @typedef {{ lang: 'en'|'kg'|'ru', describeInsight?: (kind: string) => string,
 *   context?: CoachContext|null, name?: string }} AnswerOptions
 * @typedef {{ intentId: string, text: string, confidence: number, context: CoachContext,
 *   suggestions: Suggestion[] }} CoachReply
 */

/**
 * Answers one chat message. Pass the previous reply's `context` back in to get multi-turn
 * behaviour (follow-ups for "да"/"нет", no repeated variants); without it the result is the
 * same as before for intentId/text/confidence.
 * @param {string} message
 * @param {object[]} intents   validated coach intents (one with id 'fallback' recommended)
 * @param {AnswerOptions} options
 * @returns {CoachReply}
 */
export function answer(message, intents, options = {}) {
  const context = sanitizeContext(options.context)
  const { chosen, confidence } = chooseIntent(message, intents, options.lang, context)
  if (!chosen) return emptyReply(options)
  return respond(chosen, confidence, String(message ?? ''), intents, options)
}

/**
 * Answers with a specific intent — for quick-reply buttons (`suggestions[].id`).
 * Unknown ids fall back like an unrecognised message.
 * @param {string} intentId
 * @param {object[]} intents
 * @param {AnswerOptions} options
 * @returns {CoachReply}
 */
export function answerIntent(intentId, intents, options = {}) {
  const chosen = findIntent(intents, intentId) || findIntent(intents, FALLBACK_INTENT_ID)
  if (!chosen) return emptyReply(options)
  return respond(chosen, chosen.id === intentId ? 1 : 0, `@${intentId}`, intents, options)
}
