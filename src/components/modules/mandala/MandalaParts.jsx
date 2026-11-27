import { motion } from 'framer-motion'
import { MessageCircle, Plus } from 'lucide-react'
import Icon from '../../ui/Icon'
import { DIRECTION_COLORS, mandalaStats, directionProgress } from './mandalaModel'

export function ProgressRing({ value, size = 44 }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} className="mandala-ring" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} className="mandala-ring-bg" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        className="mandala-ring-fg"
        strokeDasharray={c}
        strokeDashoffset={c - (c * value) / 100}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">{value}%</text>
    </svg>
  )
}

export function MandalaList({ mandalas, onOpen, onCreate, onManual, t }) {
  if (mandalas.length === 0) {
    return (
      <div className="card mandala-empty">
        <div className="mandala-empty-art" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <span key={i} className={i === 4 ? 'is-core' : ''} />)}
        </div>
        <h3>{t('mandala.emptyTitle')}</h3>
        <p>{t('mandala.emptyText')}</p>
        <div className="mandala-empty-actions">
          <button type="button" className="btn btn-primary" onClick={onCreate}>
            <Icon icon={MessageCircle} size="1em" /> {t('mandala.wizard.create')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onManual}>
            <Icon icon={Plus} size="1em" /> {t('mandala.wizard.manual')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="mandala-list">
      {mandalas.map((m, i) => {
        const stats = mandalaStats(m)
        return (
          <motion.button
            key={m.id}
            type="button"
            className="card mandala-card"
            onClick={() => onOpen(m.id)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <ProgressRing value={stats.progress} />
            <div className="mandala-card-body">
              <div className="mandala-card-title">{m.title || t('mandala.untitled')}</div>
              <div className="mandala-card-meta">
                {t('mandala.statsLine', {
                  dirs: stats.directions, done: stats.actionsDone, total: stats.actions,
                })}
              </div>
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}

export function DirectionLegend({ mandala, onOpen, t }) {
  return (
    <div className="mandala-legend">
      {mandala.directions.map((dir, d) => {
        const progress = directionProgress(dir)
        return (
          <button
            key={d}
            type="button"
            className="mandala-legend-item"
            style={{ '--c': DIRECTION_COLORS[d], '--p': `${progress}%` }}
            onClick={() => onOpen({ kind: 'direction', d })}
          >
            <span className="mandala-legend-name">{dir.text || t('mandala.direction', { n: d + 1 })}</span>
            <span className="mandala-legend-pct">{progress}%</span>
            <span className="mandala-legend-bar" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
