// Bonuses: XP, levels and badges earned from mandala progress, tasks and habits.
// Pure and derived from data the user already has — nothing extra to store or fake.
import { directionProgress, mandalaStats } from '../../components/modules/mandala/mandalaModel'

export const XP_RULES = {
  action: 10,         // each completed mandala action
  direction: 50,      // a direction with all of its actions done
  milestone: 15,      // each completed intermediate goal
  mandala: 300,       // a fully completed mandala
  task: 5,            // each completed task
  habitCheckin: 2,    // each habit check-in
}

const XP_PER_LEVEL_STEP = 100

/** Level n needs 100·(n-1)² XP: 1 → 0, 2 → 100, 3 → 400, 4 → 900 … */
export function levelForXp(xp) {
  const level = Math.floor(Math.sqrt(Math.max(xp, 0) / XP_PER_LEVEL_STEP)) + 1
  const current = XP_PER_LEVEL_STEP * (level - 1) ** 2
  const next = XP_PER_LEVEL_STEP * level ** 2
  return { level, current, next, progress: (xp - current) / (next - current) }
}

const BADGES = [
  { id: 'first-mandala', test: (s) => s.mandalas >= 1 },
  { id: 'first-step', test: (s) => s.actionsDone >= 1 },
  { id: 'ten-steps', test: (s) => s.actionsDone >= 10 },
  { id: 'fifty-steps', test: (s) => s.actionsDone >= 50 },
  { id: 'direction-master', test: (s) => s.directionsDone >= 1 },
  { id: 'balanced', test: (s) => s.balanced },
  { id: 'milestone-hunter', test: (s) => s.milestonesDone >= 5 },
  { id: 'week-streak', test: (s) => s.activeDaysLastWeek >= 5 },
  { id: 'mandala-master', test: (s) => s.mandalasDone >= 1 },
]

function lastWeekKeys(today) {
  const keys = new Set()
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return keys
}

function mandalaSummary(mandalas, today) {
  const week = lastWeekKeys(today)
  const activeDays = new Set()
  const s = { mandalas: mandalas.length, actionsDone: 0, directionsDone: 0, milestonesDone: 0, mandalasDone: 0, balanced: false }
  mandalas.forEach((m) => {
    const filledDirs = m.directions.filter((d) => d.actions.some((a) => a.text.trim()))
    filledDirs.forEach((d) => { if (directionProgress(d) === 100) s.directionsDone += 1 })
    if (filledDirs.length >= 8 && filledDirs.every((d) => directionProgress(d) >= 25)) s.balanced = true
    const cells = [m.center, ...m.directions, ...m.directions.flatMap((d) => d.actions)]
    cells.forEach((c) => { s.milestonesDone += c.milestones.filter((x) => x.done).length })
    m.directions.flatMap((d) => d.actions).forEach((a) => {
      if (a.done && a.text.trim()) s.actionsDone += 1
      if (a.done && week.has(a.doneAt)) activeDays.add(a.doneAt)
    })
    const stats = mandalaStats(m)
    if (stats.actions > 0 && stats.progress === 100) s.mandalasDone += 1
  })
  return { ...s, activeDaysLastWeek: activeDays.size }
}

/**
 * @param {{ mandalas: object[], tasks?: object[], habits?: object[] }} data normalized mandalas
 * @param {Date} [today]
 */
export function computeRewards({ mandalas = [], tasks = [], habits = [] }, today = new Date()) {
  const s = mandalaSummary(mandalas, today)
  const tasksDone = tasks.filter((t) => t.status === 'done').length
  const habitCheckins = habits.reduce((n, h) => n + (h.completions || []).length, 0)

  const xp = s.actionsDone * XP_RULES.action
    + s.directionsDone * XP_RULES.direction
    + s.milestonesDone * XP_RULES.milestone
    + s.mandalasDone * XP_RULES.mandala
    + tasksDone * XP_RULES.task
    + habitCheckins * XP_RULES.habitCheckin

  return {
    xp,
    ...levelForXp(xp),
    stats: { ...s, tasksDone, habitCheckins },
    badges: BADGES.map((b) => ({ id: b.id, unlocked: b.test(s) })),
  }
}
