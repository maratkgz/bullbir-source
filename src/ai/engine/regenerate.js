// "Too hard" / "Not for me" — regenerates one action or a whole direction of a mandala.
// Deterministic (no randomness): repeated "not for me" rotates through the candidates using a
// counter kept in the cell's `src` ("health:3:5@2"). Inputs are never mutated; done cells stay.
import { normalize } from './text'
import { classifyGoal, FALLBACK_DOMAIN_ID } from './classifier'
import { pick, SLOTS } from '../library/schema'
import { normalizeCell } from '../../components/modules/mandala/mandalaModel'
import { defaultMinutes } from './itemTypes'
import { actionCell, directionCell, makeSrc, parseSrc, resolveSrc, templateDirection } from './mandalaGenerator'

export const REASONS = ['too_hard', 'not_me']
const LIGHTER_FREQ = { daily: '3w', '3w': 'weekly', weekly: 'weekly' }
const MIN_MINUTES = 5

const dirRefs = (domain) => [
  ...(domain.directions || []).map((_, d) => String(d)),
  ...(domain.spares || []).map((_, k) => `s${k}`),
]

/** Which library domain (+ direction ref) a cell came from; falls back to the mandala's sphere. */
function originOf(mandala, d, cell, domains) {
  const counter = parseSrc(cell?.src)?.counter || 0
  const own = parseSrc(cell?.src) || parseSrc(mandala.directions[d]?.src)
  const byId = (id) => domains.find((x) => x.id === id)
  if (own && byId(own.domainId)) return { domain: byId(own.domainId), dir: own.dir, counter }
  const anySrc = mandala.directions.flatMap((dir) => [dir, ...dir.actions]).map((c) => parseSrc(c.src)).find((r) => r && byId(r.domainId))
  const goalId = mandala.center?.text ? classifyGoal(mandala.center.text, domains)[0]?.id : null
  const domain = byId(anySrc?.domainId) || byId(goalId) || byId(FALLBACK_DOMAIN_ID) || domains[0]
  return domain ? { domain, dir: String(Math.min(d, SLOTS - 1)), counter } : null
}

const replaceAction = (mandala, d, i, cell) => ({
  ...mandala,
  directions: mandala.directions.map((dir, k) => (k !== d ? dir
    : { ...dir, actions: dir.actions.map((a, j) => (j === i ? cell : a)) })),
})

/** Lighter version of a cell: library `easy` text first, else fewer minutes and a rarer frequency. */
export function lighterCell(cell, { domains = [], lang = 'ru' } = {}) {
  const tpl = resolveSrc(domains, cell.src)?.action
  const easy = tpl?.easy ? pick(tpl.easy, lang) : ''
  const minutes = Math.max(Math.floor((cell.minutes || defaultMinutes(cell.type || 'habit')) / 2), MIN_MINUTES)
  const isHabit = cell.type === 'habit' || (!cell.type && !!cell.freq)
  const freq = isHabit ? LIGHTER_FREQ[cell.freq || 'daily'] : cell.freq
  if (easy && normalize(easy) !== normalize(cell.text)) return normalizeCell({ ...cell, text: easy, minutes })
  return normalizeCell({ ...cell, minutes, freq })
}

/** Ordered candidate actions: same direction → other directions/spares → universal domain. */
function actionCandidates(domain, dir, domains) {
  const fromDomain = (dom, first) => [first, ...dirRefs(dom).filter((r) => r !== first)]
    .filter((r) => templateDirection(dom, r))
    .flatMap((r) => templateDirection(dom, r).actions.map((tpl, i) => ({ tpl, src: makeSrc(dom.id, r, i) })))
  const universal = domain.id === FALLBACK_DOMAIN_ID ? null : domains.find((x) => x.id === FALLBACK_DOMAIN_ID)
  return [...fromDomain(domain, dir), ...(universal ? fromDomain(universal, '0') : [])]
}

/** Normalized texts of all cells except `own` (so the cell's own text stays in the rotation). */
const otherTexts = (cells, own) => new Set(cells.filter((c) => c !== own).map((c) => normalize(c.text)).filter(Boolean))

/** Candidate at `counter` (mod length), skipping the one equal to the current text. */
function rotate(candidates, counter, ownText, textOf) {
  const at = (k) => candidates[k % candidates.length]
  const first = at(counter)
  if (normalize(textOf(first)) !== normalize(ownText)) return first
  return candidates.length > 1 ? at(counter + 1) : null
}

/**
 * @param {object} mandala normalized mandala
 * @param {number} d direction index 0..7
 * @param {number} i action index 0..7
 * @param {'too_hard'|'not_me'} reason
 * @param {{ domains: object[], lang: 'en'|'kg'|'ru' }} options
 * @returns {object} new mandala (unchanged copy when nothing applies or the cell is done)
 */
export function regenerateItem(mandala, d, i, reason, { domains = [], lang = 'ru' } = {}) {
  const cell = mandala?.directions?.[d]?.actions?.[i]
  if (!cell || cell.done || !REASONS.includes(reason)) return mandala ? { ...mandala } : mandala
  if (reason === 'too_hard') return replaceAction(mandala, d, i, lighterCell(cell, { domains, lang }))
  const origin = originOf(mandala, d, cell, domains)
  if (!origin) return { ...mandala }
  const taken = otherTexts(mandala.directions.flatMap((dir) => [dir, ...dir.actions]), cell)
  const candidates = actionCandidates(origin.domain, origin.dir, domains)
    .filter((c) => !taken.has(normalize(pick(c.tpl, lang))))
  const chosen = candidates.length ? rotate(candidates, origin.counter, cell.text, (c) => pick(c.tpl, lang)) : null
  if (!chosen) return { ...mandala }
  const next = actionCell(chosen.tpl, lang, `${chosen.src}@${origin.counter + 1}`)
  return replaceAction(mandala, d, i, { ...next, deadline: cell.deadline })
}

/** Ordered candidate directions: domain spares → universal directions and spares. */
function directionCandidates(domain, domains) {
  const spares = (domain.spares || []).map((tpl, k) => ({ tpl, domainId: domain.id, ref: `s${k}` }))
  const universal = domain.id === FALLBACK_DOMAIN_ID ? domain : domains.find((x) => x.id === FALLBACK_DOMAIN_ID)
  const fromUniversal = universal && universal !== domain
    ? dirRefs(universal).map((ref) => ({ tpl: templateDirection(universal, ref), domainId: universal.id, ref }))
    : []
  return [...spares, ...fromUniversal]
}

function buildDirection(dir, candidate, lang, counter) {
  const { tpl, domainId, ref } = candidate
  const head = dir.done ? { ...dir } : directionCell(tpl, lang, `${makeSrc(domainId, ref)}@${counter}`)
  const actions = dir.actions.map((a, i) => (a.done ? a : actionCell(tpl.actions[i], lang, makeSrc(domainId, ref, i))))
  const { actions: _drop, ...headCell } = head
  return { ...headCell, actions }
}

/**
 * Replaces a whole direction ('not_me') or lightens all its open actions ('too_hard').
 * Done cells are kept in place.
 * @returns {object} new mandala
 */
export function regenerateDirection(mandala, d, reason, { domains = [], lang = 'ru' } = {}) {
  const dir = mandala?.directions?.[d]
  if (!dir || !REASONS.includes(reason)) return mandala ? { ...mandala } : mandala
  const withDir = (next) => ({ ...mandala, directions: mandala.directions.map((x, k) => (k === d ? next : x)) })
  if (reason === 'too_hard') {
    return withDir({ ...dir, actions: dir.actions.map((a) => (a.done || !a.text.trim() ? a : lighterCell(a, { domains, lang }))) })
  }
  const origin = originOf(mandala, d, dir, domains)
  if (!origin) return { ...mandala }
  const taken = otherTexts(mandala.directions, dir)
  const candidates = directionCandidates(origin.domain, domains)
    .filter((c) => c.tpl && !taken.has(normalize(pick(c.tpl.title, lang))))
  const chosen = candidates.length ? rotate(candidates, origin.counter, dir.text, (c) => pick(c.tpl.title, lang)) : null
  if (!chosen) return { ...mandala }
  return withDir(buildDirection(dir, chosen, lang, origin.counter + 1))
}
