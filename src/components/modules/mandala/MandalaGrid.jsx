import { useLang } from '../../../context/LangContext'
import { RING_POSITIONS, DIRECTION_COLORS, directionProgress, isOverdue } from './mandalaModel'
import { Check } from 'lucide-react'
import Icon from '../../ui/Icon'

const CENTER_POS = 4
const BLOCK_POSITIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8]
// position (0..8) → direction/action index, inverse of RING_POSITIONS
const INDEX_AT_POS = Object.fromEntries(RING_POSITIONS.map((pos, i) => [pos, i]))

function MandalaCell({ cell, kind, color, todayKey, label, onClick }) {
  const isEmpty = !cell.text.trim()
  const msDone = cell.milestones.filter((m) => m.done).length
  const classes = [
    'mandala-cell',
    `mandala-cell--${kind}`,
    cell.done && 'is-done',
    isEmpty && 'is-empty',
    isOverdue(cell, todayKey) && 'is-overdue',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={classes}
      style={{ '--c': color }}
      onClick={onClick}
      aria-label={`${label}: ${isEmpty ? '—' : cell.text}`}
      title={cell.text || label}
    >
      <span className="mandala-cell-text">{isEmpty ? '+' : cell.text}</span>
      {(cell.done || cell.milestones.length > 0 || cell.deadline) && (
        <span className="mandala-cell-meta" aria-hidden="true">
          {cell.done && <span className="mandala-badge mandala-badge--done"><Icon icon={Check} size="1em" /></span>}
          {cell.milestones.length > 0 && (
            <span className="mandala-badge">{msDone}/{cell.milestones.length}</span>
          )}
          {cell.deadline && !cell.done && <span className="mandala-dot" />}
        </span>
      )}
    </button>
  )
}

function DirectionCell({ dir, d, todayKey, label, onOpen }) {
  const progress = directionProgress(dir)
  return (
    <div className="mandala-dir-wrap" style={{ '--p': `${progress}%`, '--c': DIRECTION_COLORS[d] }}>
      <MandalaCell
        cell={dir}
        kind="direction"
        color={DIRECTION_COLORS[d]}
        todayKey={todayKey}
        label={label}
        onClick={() => onOpen({ kind: 'direction', d })}
      />
      <span className="mandala-dir-bar" aria-hidden="true" />
    </div>
  )
}

function CenterBlock({ mandala, todayKey, onOpen, t }) {
  return (
    <div className="mandala-block mandala-block--center">
      {BLOCK_POSITIONS.map((pos) => {
        if (pos === CENTER_POS) {
          return (
            <MandalaCell
              key={pos}
              cell={mandala.center}
              kind="center"
              color="var(--primary)"
              todayKey={todayKey}
              label={t('mandala.mainGoal')}
              onClick={() => onOpen({ kind: 'center' })}
            />
          )
        }
        const d = INDEX_AT_POS[pos]
        return (
          <DirectionCell
            key={pos}
            dir={mandala.directions[d]}
            d={d}
            todayKey={todayKey}
            label={t('mandala.direction', { n: d + 1 })}
            onOpen={onOpen}
          />
        )
      })}
    </div>
  )
}

function DirectionBlock({ dir, d, todayKey, onOpen, t }) {
  const color = DIRECTION_COLORS[d]
  return (
    <div className="mandala-block" style={{ '--c': color }}>
      {BLOCK_POSITIONS.map((pos) => {
        if (pos === CENTER_POS) {
          return (
            <DirectionCell
              key={pos}
              dir={dir}
              d={d}
              todayKey={todayKey}
              label={t('mandala.direction', { n: d + 1 })}
              onOpen={onOpen}
            />
          )
        }
        const a = INDEX_AT_POS[pos]
        return (
          <MandalaCell
            key={pos}
            cell={dir.actions[a]}
            kind="action"
            color={color}
            todayKey={todayKey}
            label={t('mandala.action', { n: a + 1 })}
            onClick={() => onOpen({ kind: 'action', d, a })}
          />
        )
      })}
    </div>
  )
}

/** Full 9×9 grid: centre block (goal + 8 directions) surrounded by 8 direction blocks. */
export default function MandalaGrid({ mandala, zoom, todayKey, onOpen }) {
  const { t } = useLang()
  return (
    <div className="mandala-scroll">
      <div className="mandala-grid" style={{ '--zoom': zoom }}>
        {BLOCK_POSITIONS.map((pos) => {
          if (pos === CENTER_POS) {
            return <CenterBlock key={pos} mandala={mandala} todayKey={todayKey} onOpen={onOpen} t={t} />
          }
          const d = INDEX_AT_POS[pos]
          return (
            <DirectionBlock
              key={pos}
              dir={mandala.directions[d]}
              d={d}
              todayKey={todayKey}
              onOpen={onOpen}
              t={t}
            />
          )
        })}
      </div>
    </div>
  )
}
