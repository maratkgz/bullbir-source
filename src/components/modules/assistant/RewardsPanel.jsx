import { useLang } from '../../../context/LangContext'
import { XP_RULES } from '../../../ai/engine/rewards'
import { Flame, Footprints, Grid3x3, ListChecks, Lock, Medal, Rocket, Scale, Target, Trophy } from 'lucide-react'
import Icon from '../../ui/Icon'

const BADGE_ICONS = {
  'first-mandala': Grid3x3,
  'first-step': Footprints,
  'ten-steps': ListChecks,
  'fifty-steps': Rocket,
  'direction-master': Medal,
  balanced: Scale,
  'milestone-hunter': Target,
  'week-streak': Flame,
  'mandala-master': Trophy,
}

/** XP, level and badges — all derived from real progress. */
export default function RewardsPanel({ rewards }) {
  const { t } = useLang()
  const pct = Math.round(Math.min(Math.max(rewards.progress, 0), 1) * 100)
  return (
    <div className="ai-review">
      <div className="card ai-level">
        <div className="ai-level-badge">{rewards.level}</div>
        <div style={{ flex: 1 }}>
          <strong>{t('ai.rewards.level', { level: rewards.level })}</strong>
          <div className="ai-level-bar" style={{ '--p': `${pct}%` }} aria-hidden="true" />
          <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
            {t('ai.rewards.xp', { xp: rewards.xp, next: rewards.next })}
          </span>
        </div>
      </div>

      <div className="ai-badges">
        {rewards.badges.map((b) => (
          <div key={b.id} className={`card ai-badge${b.unlocked ? ' is-unlocked' : ''}`}>
            <span className="ai-badge-icon"><Icon icon={b.unlocked ? BADGE_ICONS[b.id] : Lock} size={28} /></span>
            <strong>{t(`ai.badge.${b.id}`)}</strong>
            <span className="text-secondary">{t(`ai.badge.${b.id}.how`)}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <span className="section-title">{t('ai.rewards.howTitle')}</span>
        <ul className="ai-insights">
          {Object.entries(XP_RULES).map(([rule, xp]) => (
            <li key={rule} className="ai-insight"><span>+{xp} XP</span><span>{t(`ai.xp.${rule}`)}</span></li>
          ))}
        </ul>
      </div>
    </div>
  )
}
