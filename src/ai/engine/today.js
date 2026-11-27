// "Today" plan: up to 3 tasks from different mandala directions that fit the user's daily time,
// lagging directions and overdue tasks first, plus the qualities to keep in mind.
import { directionProgress } from '../../components/modules/mandala/mandalaModel'
import { parseDay, toDateKey } from './dates'
import { defaultMinutes } from './itemTypes'

export const TODAY_LIMITS = { tasks: 3, qualities: 5, defaultMinutesPerDay: 30 }
const LAGGING_PCT = 50

const dayKey = (value) => {
  const d = value ? parseDay(value) : null
  return d && !Number.isNaN(d.getTime()) ? toDateKey(d) : ''
}

/** Open tasks linked to an existing mandala action, enriched with direction info. */
function candidates(mandalas, tasks, todayKey) {
  const byId = new Map(mandalas.map((m) => [m.id, m]))
  return tasks.flatMap((task, order) => {
    const ref = task?.mandalaRef
    const m = ref ? byId.get(ref.id) : null
    const dir = m?.directions?.[ref.d]
    const cell = dir?.actions?.[ref.a]
    if (!cell || task.status === 'done') return []
    const deadline = dayKey(task.deadline)
    return [{
      taskId: task.id,
      mandalaId: m.id,
      directionId: `${m.id}:${ref.d}`,
      direction: dir.text,
      progress: directionProgress(dir),
      minutes: cell.minutes || defaultMinutes(cell.type || 'habit'),
      overdue: !!deadline && deadline < todayKey,
      deadline,
      order,
    }]
  })
}

const byUrgency = (a, b) => (Number(b.overdue) - Number(a.overdue))
  || (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.order - b.order

/** Direction groups, lagging (lowest progress) first; each group's tasks most urgent first. */
function groupByDirection(items) {
  const groups = new Map()
  items.forEach((it) => groups.set(it.directionId, [...(groups.get(it.directionId) || []), it]))
  return [...groups.values()]
    .map((list) => [...list].sort(byUrgency))
    .sort((a, b) => a[0].progress - b[0].progress || byUrgency(a[0], b[0]))
}

function why(item) {
  const vars = { direction: item.direction }
  if (item.overdue) return { key: 'ai.today.why.overdue', vars }
  if (item.progress < LAGGING_PCT) return { key: 'ai.today.why.lagging', vars }
  return { key: 'ai.today.why.next', vars }
}

function qualitiesOf(mandalas) {
  return mandalas.flatMap((m) => m.directions.flatMap((dir, d) => dir.actions
    .map((cell, i) => ({ cell, i }))
    .filter(({ cell }) => cell.type === 'quality' && cell.text.trim())
    .map(({ cell, i }) => ({ mandalaId: m.id, d, i, text: cell.text }))))
    .slice(0, TODAY_LIMITS.qualities)
}

/**
 * @param {{ mandalas: object[], tasks: object[], minutesPerDay?: number, today?: Date|string }} input
 *   mandalas normalized with `id`; tasks with `id`, `status`, `deadline`, `mandalaRef {id,d,a}`
 * @returns {{ tasks: Array<{ taskId, directionId, mandalaId, minutes, why: { key, vars } }>,
 *   qualities: Array<{ mandalaId, d, i, text }>, minutesTotal: number }}
 */
export function todayPlan({ mandalas = [], tasks = [], minutesPerDay, today = new Date() } = {}) {
  const budget = Number(minutesPerDay) > 0 ? Number(minutesPerDay) : TODAY_LIMITS.defaultMinutesPerDay
  const groups = groupByDirection(candidates(mandalas, tasks, dayKey(today)))
  const picked = groups.reduce((acc, group) => {
    if (acc.list.length >= TODAY_LIMITS.tasks) return acc
    const fit = group.find((it) => acc.total + it.minutes <= budget)
    return fit ? { list: [...acc.list, fit], total: acc.total + fit.minutes } : acc
  }, { list: [], total: 0 })
  return {
    tasks: picked.list.map((it) => ({
      taskId: it.taskId, directionId: it.directionId, mandalaId: it.mandalaId, minutes: it.minutes, why: why(it),
    })),
    qualities: qualitiesOf(mandalas),
    minutesTotal: picked.total,
  }
}
