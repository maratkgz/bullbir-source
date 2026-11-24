// Builds a 9×9 mandala from a library domain template.
import { pick } from '../library/schema'
import { emptyMandala, normalizeCell, normalizeMandala } from '../../components/modules/mandala/mandalaModel'

const isEmpty = (cell) => !cell?.text?.trim()

function templateCell(text, milestones = [], idPrefix = '') {
  return normalizeCell({
    text,
    milestones: milestones.map((m, i) => ({ id: `${idPrefix}ms${i}`, text: m, done: false, deadline: '' })),
  })
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
    const suggestedDir = templateCell(
      pick(tpl.title, lang),
      (tpl.milestones || []).map((m) => pick(m, lang)),
      `ai-${domain.id}-${d}-`,
    )
    const head = isEmpty(dir) ? suggestedDir : { ...dir }
    const actions = dir.actions.map((a, i) => mergeCell(a, templateCell(pick(tpl.actions[i], lang))))
    const { actions: _drop, ...headCell } = head
    return { ...headCell, actions }
  })

  return { title: center.text, center, directions }
}
