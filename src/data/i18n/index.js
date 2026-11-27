// Feature translation packs, kept in separate files so features can be worked on in parallel.
import mandala from './mandala'
import plan from './plan'
import today from './today'
import coach from './coach'
import goals from './goals'
import dashboard from './dashboard'
import profile from './profile'
import misc from './misc'

// misc goes first: later packs win on a shared key, so a feature pack can override its fallbacks.
export const FEATURE_PACKS = [misc, mandala, plan, today, coach, goals, dashboard, profile]

/** Returns new dictionaries: base strings plus every pack (packs never override base keys). */
export function mergePacks(base, packs) {
  return Object.fromEntries(
    Object.entries(base).map(([lang, dict]) => [
      lang,
      Object.assign({}, ...packs.map((p) => p[lang] || {}), dict),
    ]),
  )
}
