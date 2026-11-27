import { motion, useReducedMotion } from 'framer-motion'
import { Check, Repeat, Flag, Sparkles } from 'lucide-react'
import Icon from '../../ui/Icon'
import { DIRECTION_COLORS, directionProgress, isOverdue } from './mandalaModel'
import { waveDelay } from './gridLayout'

export const TYPE_ICONS = { habit: Repeat, milestone: Flag, quality: Sparkles }
const HOVER = { y: -1 }

function TypeIcon({ type, t }) {
  const icon = TYPE_ICONS[type]
  if (!icon) return null
  return (
    <span className="mandala-type">
      <Icon icon={icon} size="1em" label={t(`mandala.type.${type}`)} />
    </span>
  )
}

/** One cell of the grid; enters in a wave from the centre (`distance`) unless motion is reduced. */
export function MandalaCell({ cell, kind, color, todayKey, label, distance = 0, onClick, t }) {
  const reduceMotion = useReducedMotion()
  const isEmpty = !cell.text.trim()
  const msDone = cell.milestones.filter((m) => m.done).length
  const classes = [
    'mandala-cell',
    `mandala-cell--${kind}`,
    cell.done && 'is-done',
    isEmpty && 'is-empty',
    isOverdue(cell, todayKey) && 'is-overdue',
  ].filter(Boolean).join(' ')
  const typeName = cell.type ? `, ${t(`mandala.type.${cell.type}`)}` : ''
  const motionProps = reduceMotion ? {} : {
    initial: { opacity: 0, scale: 0.86 },
    animate: { opacity: 1, scale: 1 },
    transition: { delay: waveDelay(distance), duration: 0.28, ease: 'easeOut' },
    whileHover: HOVER,
  }

  return (
    <motion.button
      type="button"
      className={classes}
      style={{ '--c': color }}
      onClick={onClick}
      aria-label={`${label}${typeName}: ${isEmpty ? '—' : cell.text}`}
      title={cell.text || label}
      {...motionProps}
    >
      <span className="mandala-cell-text">{isEmpty ? '+' : cell.text}</span>
      {!isEmpty && kind === 'action' && <TypeIcon type={cell.type} t={t} />}
      {(cell.done || cell.milestones.length > 0 || cell.deadline) && (
        <span className="mandala-cell-meta" aria-hidden="true">
          {cell.done && <span className="mandala-badge mandala-badge--done"><Icon icon={Check} size="1em" /></span>}
          {cell.milestones.length > 0 && (
            <span className="mandala-badge">{msDone}/{cell.milestones.length}</span>
          )}
          {cell.deadline && !cell.done && <span className="mandala-dot" />}
        </span>
      )}
    </motion.button>
  )
}

/** Direction cell with a progress bar along its bottom edge. */
export function DirectionCell({ dir, d, onClick, ...rest }) {
  const progress = directionProgress(dir)
  const color = DIRECTION_COLORS[d]
  return (
    <div className="mandala-dir-wrap" style={{ '--p': `${progress}%`, '--c': color }}>
      <MandalaCell cell={dir} kind="direction" color={color} onClick={onClick} {...rest} />
      <span className="mandala-dir-bar" aria-hidden="true" />
    </div>
  )
}
