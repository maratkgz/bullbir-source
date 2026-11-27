// Feature translation packs, kept in separate files so features can be worked on in parallel.
import mandala from './mandala'
import plan from './plan'
import today from './today'
import coach from './coach'
import goals from './goals'
import dashboard from './dashboard'

export const FEATURE_PACKS = [mandala, plan, today, coach, goals, dashboard]

/** Returns new dictionaries: base strings plus every pack (packs never override base keys). */
export function mergePacks(base, packs) {
  return Object.fromEntries(
    Object.entries(base).map(([lang, dict]) => [
      lang,
      Object.assign({}, ...packs.map((p) => p[lang] || {}), dict),
    ]),
  )
}
