// Builds a 9×9 mandala from a library domain template.
import { pick } from '../library/schema'
import { emptyMandala, normalizeCell, normalizeKind, normalizeMandala } from '../../components/modules/mandala/mandalaModel'
import { inferType, inferFreq, defaultMinutes } from './itemTypes'

const isEmpty = (cell) => !cell?.text?.trim()

// ── Library references stored in cell.src ────────────────────────────────────
// "<domainId>:<dir>[:<action>][@<counter>]"; <dir> is a direction index ("3") or a spare ("s1").
// The counter rotates "not for me" replacements deterministically.
const SRC_RE = /^([a-z0-9-]{2,40}):(s?\d)(?::(\d))?(?:@(\d{1,4}))?$/

/** @returns {string} e.g. makeSrc('health', 3, 5) → 'health:3:5'; makeSrc('health', 's1') → 'health:s1' */
export function makeSrc(domainId, dir, action, counter) {
  const base = action === undefined || action === null ? `${domainId}:${dir}` : `${domainId}:${dir}:${action}`
  return counter ? `${base}@${counter}` : base
}

/** @returns {{ domainId: string, dir: string, action: number|null, counter: number }|null} */
export function parseSrc(src) {
  const m = SRC_RE.exec(String(src || ''))
  if (!m) return null
  return { domainId: m[1], dir: m[2], action: m[3] === undefined ? null : Number(m[3]), counter: Number(m[4] || 0) }
}

/** Template direction for a dir ref ("3" → directions[3], "s1" → spares[1]). */
export function templateDirection(domain, dir) {
  if (!domain) return null
  const ref = String(dir)
  if (ref.startsWith('s')) return domain.spares?.[Number(ref.slice(1))] || null
  return domain.directions?.[Number(ref)] || null
}

/**
 * Resolves a cell's `src` to its library template.
 * @returns {{ domain: object, direction: object|null, action: object|null, ref: object }|null}
 */
export function resolveSrc(domains, src) {
  const ref = parseSrc(src)
  if (!ref) return null
  const domain = (domains || []).find((x) => x.id === ref.domainId)
  if (!domain) return null
  const direction = templateDirection(domain, ref.dir)
  const action = direction && ref.action !== null ? direction.actions?.[ref.action] || null : null
  return { domain, direction, action, ref }
}

// ── Template cells ───────────────────────────────────────────────────────────

/** Typed cell for one template action (type inferred from the text when the library has none). */
export function actionCell(tpl, lang, src) {
  const text = pick(tpl, lang)
  const type = tpl?.type || inferType(text, lang)
  const freq = type === 'habit' ? tpl?.freq || inferFreq(text) : ''
  return normalizeCell({ text, type, freq, minutes: tpl?.minutes || defaultMinutes(type), src })
}

/** Direction head cell (title + milestones + kind) from a template direction. */
export function directionCell(tpl, lang, src) {
  const idPrefix = `ai-${String(src).replace(/[^a-z0-9-]/g, '-')}-`
  const milestones = (tpl.milestones || []).map((m, i) => ({
    id: `${idPrefix}ms${i}`, text: pick(m, lang), done: false, deadline: '',
  }))
  return { ...normalizeCell({ text: pick(tpl.title, lang), milestones, src }), kind: normalizeKind(tpl.kind) }
}

/** Keeps the user's cell when it has text; otherwise takes the template cell. */
const mergeCell = (mine, suggested) => (isEmpty(mine) ? suggested : mine)

/**
 * @param {object} domain    validated library domain
 * @param {string} goal      main goal text (centre cell)
 * @param {'en'|'kg'|'ru'} lang
 * @param {{ existing?: object }} [options] existing mandala — only its EMPTY cells are filled
 * @returns {{ title: string, center: object, directions: object[] }} new object, inputs untouched
 */
export function mandalaFromDomain(domain, goal, lang, { existing } = {}) {
  const base = normalizeMandala(existing || emptyMandala(goal))
  const center = isEmpty(base.center) ? normalizeCell({ ...base.center, text: goal }) : base.center

  const directions = base.directions.map((dir, d) => {
    const tpl = domain.directions[d]
    const suggestedDir = directionCell(tpl, lang, makeSrc(domain.id, d))
    const head = isEmpty(dir) ? suggestedDir : { ...dir }
    const actions = dir.actions.map((a, i) => mergeCell(a, actionCell(tpl.actions[i], lang, makeSrc(domain.id, d, i))))
    const { actions: _drop, ...headCell } = head
    return { ...headCell, actions }
  })

  return { title: center.text, center, directions }
}
