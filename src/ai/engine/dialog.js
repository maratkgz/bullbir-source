// Multi-turn helpers for the coach: short replies ("да" / "жок" / "не знаю"), follow-ups,
// answer-variant rotation, quick-reply suggestions and the small dialogue context.
// Everything here is pure and deterministic: same input → same output, no Math.random.
import { normalize } from './text'
import { pick } from '../library/schema'

export const MAX_SUGGESTIONS = 4
const MAX_SHORT_REPLY_WORDS = 4
const MAX_NAME = 30

const UNSURE_PHRASES = new Set([
  'не знаю', 'незнаю', 'хз', 'без понятия', 'не уверен', 'не уверена', 'может быть', 'возможно',
  'билбейм', 'билбейм го', 'мүмкүн', 'балким', 'idk', 'i don t know', 'dont know', 'don t know',
  'not sure', 'maybe', 'no idea',
])
const NO_PHRASES = new Set([
  'не надо', 'не хочу', 'не сейчас', 'нет спасибо', 'не нужно', 'неа', 'керек эмес', 'жок рахмат',
  'азыр эмес', 'no thanks', 'not now', 'no thank you',
])
const YES_WORDS = new Set([
  'да', 'ага', 'угу', 'конечно', 'давай', 'давайте', 'ок', 'окей', 'хорошо', 'ладно', 'можно', 'хочу',
  'go', 'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'please', 'ооба', 'ия', 'иә', 'ии',
  'макул', 'мейли', 'болот', 'ха', 'ыя', 'пожалуйста',
])
const NO_WORDS = new Set(['нет', 'неа', 'не', 'no', 'nope', 'nah', 'жок', 'жоқ'])

/** 'yes' | 'no' | 'unsure' for short replies like "да, давай", "жок", "не знаю"; else null. */
export function classifyShortReply(message) {
  const phrase = normalize(message)
  if (!phrase) return null
  const words = phrase.split(' ')
  if (words.length > MAX_SHORT_REPLY_WORDS) return null
  if (UNSURE_PHRASES.has(phrase)) return 'unsure'
  if (NO_PHRASES.has(phrase)) return 'no'
  if (words.every((w) => NO_WORDS.has(w))) return 'no'
  if (words.every((w) => YES_WORDS.has(w))) return 'yes'
  return null
}

/** Intent the previous turn's follow-up points to for this short reply, or null. */
export function resolveFollowUp(reply, context, intents) {
  if (!reply || !context?.followUp) return null
  const prev = intents.find((i) => i.id === context.followUp)
  const targetId = prev?.followUps?.[reply] || prev?.followUps?.any
  return targetId ? intents.find((i) => i.id === targetId) || null : null
}

/** Stable 32-bit string hash (deterministic replacement for Math.random). */
export function stableIndex(text, length) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return length ? h % length : 0
}

function variantsFor(intent, lang) {
  const own = intent.answers?.[lang]
  return own?.length ? own : intent.answers?.ru || intent.answers?.en || []
}

/**
 * Picks an answer variant. Without context it depends on the message only (old behaviour);
 * with context it also mixes in the turn and never repeats the previous variant of the same intent.
 */
export function pickVariant(intent, lang, seed, context) {
  const variants = variantsFor(intent, lang)
  if (!variants.length) return { text: '', index: -1 }
  const turn = context?.turn || 0
  let index = stableIndex(turn ? `${seed}#${turn}` : seed, variants.length)
  const repeated = context?.lastIntentId === intent.id && context?.lastVariant === index
  if (repeated && variants.length > 1) index = (index + 1) % variants.length
  return { text: variants[index], index }
}

/** Replaces {name} with the user's name, or drops it (with its comma) when there is none. */
export function personalize(text, name) {
  const clean = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : ''
  // "Привет{name}!" → "Привет, Марат!" — a placeholder glued to a word gets ", ".
  if (clean) return text.replace(/(\p{L})\{name\}/gu, `$1, ${clean}`).replace(/\{name\}/g, clean)
  return text.replace(/,?\s*\{name\}/g, '')
}

/** Quick-reply buttons: intents listed in `suggest` that exist and have a label. */
export function buildSuggestions(intent, intents, lang) {
  const ids = Array.isArray(intent?.suggest) ? intent.suggest : []
  return ids
    .map((id) => intents.find((i) => i.id === id))
    .filter((i) => i && i.label)
    .slice(0, MAX_SUGGESTIONS)
    .map((i) => ({ id: i.id, label: pick(i.label, lang) }))
}

/** Accepts only the known context fields with the right types (context may come from UI state). */
export function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return null
  const str = (v) => (typeof v === 'string' ? v : null)
  return {
    lastIntentId: str(context.lastIntentId),
    topic: str(context.topic),
    followUp: str(context.followUp),
    turn: Number.isInteger(context.turn) && context.turn >= 0 ? context.turn : 0,
    lastVariant: Number.isInteger(context.lastVariant) ? context.lastVariant : -1,
  }
}

/** New context after answering with `intent` (never mutates the previous one). */
export function nextContext(prev, intent, variantIndex) {
  return {
    lastIntentId: intent.id,
    topic: intent.topic || null,
    followUp: intent.followUps ? intent.id : null,
    turn: (prev?.turn || 0) + 1,
    lastVariant: variantIndex,
  }
}
