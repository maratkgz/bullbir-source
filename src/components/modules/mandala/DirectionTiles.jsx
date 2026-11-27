import { motion, useReducedMotion } from 'framer-motion'
import { useLang } from '../../../context/LangContext'
import { DIRECTION_COLORS, directionProgress } from './mandalaModel'
import { blockCells, blockDistance, directionCount, waveDelay } from './gridLayout'

function useWave(pos) {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return {}
  return {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    transition: { delay: waveDelay(blockDistance(pos) * 2), duration: 0.28, ease: 'easeOut' },
  }
}

function GoalTile({ cell, pos, onOpen, t }) {
  const wave = useWave(pos)
  const text = cell.text.trim()
  return (
    <motion.button
      type="button"
      className={`mandala-tile mandala-tile--goal${cell.done ? ' is-done' : ''}`}
      onClick={onOpen}
      aria-label={`${t('mandala.mainGoal')}: ${text || '—'}`}
      {...wave}
    >
      <span className="mandala-tile-title">{text || t('mandala.mainGoal')}</span>
    </motion.button>
  )
}

function DirTile({ dir, d, pos, isSelected, onSelect, t }) {
  const wave = useWave(pos)
  const { done, total } = directionCount(dir)
  const name = dir.text.trim() || t('mandala.direction', { n: d + 1 })
  const style = { '--c': DIRECTION_COLORS[d], '--p': `${directionProgress(dir)}%` }
  return (
    <motion.button
      type="button"
      className={`mandala-tile${dir.text.trim() ? '' : ' is-empty'}${isSelected ? ' is-selected' : ''}`}
      style={style}
      onClick={() => onSelect(d)}
      aria-pressed={isSelected === undefined ? undefined : isSelected}
      aria-label={`${name}. ${t('mandala.tile.progress', { done, total })}`}
      {...wave}
    >
      <span className="mandala-tile-title">{name}</span>
      <span className="mandala-tile-count" aria-hidden="true">{done}/{total}</span>
      <span className="mandala-tile-bar" aria-hidden="true" />
    </motion.button>
  )
}

/**
 * Centre 3×3 for phones and tablets: the goal in the middle, the 8 directions around it as large
 * coloured tiles. `selected` (tablet only) marks the direction shown next to the tiles.
 */
export default function DirectionTiles({ mandala, selected, onSelect, onOpenGoal }) {
  const { t } = useLang()
  return (
    <div className="mandala-tiles">
      {blockCells(mandala, null).map((item) => (item.kind === 'center' ? (
        <GoalTile key={item.pos} cell={item.cell} pos={item.pos} onOpen={onOpenGoal} t={t} />
      ) : (
        <DirTile
          key={item.pos}
          dir={item.cell}
          d={item.d}
          pos={item.pos}
          isSelected={selected === undefined ? undefined : selected === item.d}
          onSelect={onSelect}
          t={t}
        />
      )))}
    </div>
  )
}
