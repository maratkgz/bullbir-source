// Safety screen for free text the user gives the coach (goals, interview answers, chat).
// Lexicon-based (src/ai/library/safety.json), whole-word matching on normalized text.
// Crisis and violence stop planning: the UI must show help resources instead of a plan.
import lexicon from '../library/safety.json'
import { LANGS } from '../library/schema'
import { normalize } from './text'

export const SAFETY_LEVELS = ['ok', 'crisis', 'violence', 'illegal', 'health', 'money']
/** Priority order: the first level that matches wins. */
export const SAFETY_PRIORITY = ['crisis', 'violence', 'illegal', 'health', 'money']
export const STOPS_PLANNING = ['crisis', 'violence']

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "поддельн* документ*" → regex matching whole words, `*` = any word ending. */
function entryRegex(entry) {
  const words = String(entry).split(/\s+/).filter(Boolean).map((w) => {
    const isStem = w.endsWith('*')
    const body = escape(normalize(isStem ? w.slice(0, -1) : w))
    return isStem ? `${body}[\\p{L}\\p{N}]*` : body
  }).filter((w) => w)
  return words.length ? new RegExp(`(?:^| )${words.join(' ')}(?= |$)`, 'gu') : null
}

function compileList(byLang) {
  return LANGS.flatMap((l) => byLang?.[l] || []).map(entryRegex).filter(Boolean)
}

/** Compiles a lexicon ({ exclusions, levels }) into regex lists; exported for tests/admin. */
export function compileLexicon(source) {
  return {
    exclusions: compileList(source.exclusions),
    levels: SAFETY_PRIORITY.map((level) => ({ level, patterns: compileList(source.levels?.[level]) })),
  }
}

const COMPILED = compileLexicon(lexicon)

/**
 * @param {string} text any user text, in any of EN / KG / RU (mixed is fine)
 * @param {object} [compiled] compiled lexicon (defaults to the built-in one)
 * @returns {{ level: 'ok'|'crisis'|'violence'|'illegal'|'health'|'money', key: string|null }}
 *   key = 'ai.safety.<level>', or null for 'ok' (nothing to show)
 */
export function checkSafety(text, compiled = COMPILED) {
  const cleaned = compiled.exclusions.reduce((s, re) => s.replace(re, ' '), normalize(text))
  const norm = cleaned.replace(/\s+/g, ' ').trim()
  if (!norm) return { level: 'ok', key: null }
  const hit = compiled.levels.find(({ patterns }) => patterns.some((re) => {
    re.lastIndex = 0
    return re.test(norm)
  }))
  return hit ? { level: hit.level, key: `ai.safety.${hit.level}` } : { level: 'ok', key: null }
}

/** True when the level means "do not plan, show help instead". */
export const stopsPlanning = (level) => STOPS_PLANNING.includes(level)
