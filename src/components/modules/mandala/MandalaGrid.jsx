import { useLang } from '../../../context/LangContext'
import { DIRECTION_COLORS } from './mandalaModel'
import { BLOCK_POSITIONS, blockCells, focusAtBlock, gridDistance } from './gridLayout'
import { MandalaCell, DirectionCell } from './MandalaCell'

const cellLabel = (item, t) => {
  if (item.kind === 'center') return t('mandala.mainGoal')
  if (item.kind === 'direction') return t('mandala.direction', { n: item.d + 1 })
  return t('mandala.action', { n: item.a + 1 })
}

/**
 * One 3×3 block. `focus` null = centre block (goal + directions), 0..7 = a direction block.
 * `distanceOf(pos)` gives each cell's distance from the centre for the entrance wave.
 * `onCellClick(item)` receives { kind, d, a, ref, cell }.
 */
export function MandalaBlock({ mandala, focus, todayKey, distanceOf, onCellClick, className = '' }) {
  const { t } = useLang()
  const isCenterBlock = focus === null
  const color = isCenterBlock ? undefined : DIRECTION_COLORS[focus]
  const classes = ['mandala-block', isCenterBlock && 'mandala-block--center', className].filter(Boolean).join(' ')

  return (
    <div className={classes} style={color ? { '--c': color } : undefined}>
      {blockCells(mandala, focus).map((item) => {
        const common = {
          todayKey, t,
          label: cellLabel(item, t),
          distance: distanceOf(item.pos),
          onClick: () => onCellClick(item),
        }
        if (item.kind === 'direction') return <DirectionCell key={item.pos} dir={item.cell} d={item.d} {...common} />
        const cellColor = item.kind === 'center' ? 'var(--primary)' : color
        return <MandalaCell key={item.pos} cell={item.cell} kind={item.kind} color={cellColor} {...common} />
      })}
    </div>
  )
}

/**
 * Full 9×9 grid (≥ 900px): centre block (goal + 8 directions) surrounded by 8 direction blocks.
 * The wrapper is a size container, so cells and their text scale with the space available.
 */
export default function MandalaGrid({ mandala, todayKey, onOpen }) {
  return (
    <div className="mandala-scroll">
      <div className="mandala-grid">
        {BLOCK_POSITIONS.map((blockPos) => (
          <MandalaBlock
            key={blockPos}
            mandala={mandala}
            focus={focusAtBlock(blockPos)}
            todayKey={todayKey}
            distanceOf={(pos) => gridDistance(blockPos, pos)}
            onCellClick={(item) => onOpen(item.ref)}
          />
        ))}
      </div>
    </div>
  )
}
