import { useState } from 'react'
import { useLang } from '../../../context/LangContext'
import { ArrowLeft } from 'lucide-react'
import Icon from '../../ui/Icon'
import { DIRECTION_COLORS } from './mandalaModel'
import { blockDistance } from './gridLayout'
import { MandalaBlock } from './MandalaGrid'

/**
 * Mobile view: the central 3×3 (goal + 8 directions) first; tapping a direction opens its own
 * 3×3 (direction + 8 actions). Tapping the goal, or a cell inside a direction, opens the editor.
 */
export default function MandalaMobile({ mandala, todayKey, onOpen }) {
  const { t } = useLang()
  const [focus, setFocus] = useState(null)
  const dir = focus === null ? null : mandala.directions[focus]

  const handleCell = (item) => {
    if (focus === null && item.kind === 'direction') setFocus(item.d)
    else onOpen(item.ref)
  }

  return (
    <div className="mandala-mobile">
      <div className="mandala-mobile-head">
        {dir ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFocus(null)}>
              <Icon icon={ArrowLeft} size="1em" /> {t('mandala.mobile.back')}
            </button>
            <span className="mandala-mobile-title" style={{ '--c': DIRECTION_COLORS[focus] }}>
              {dir.text || t('mandala.direction', { n: focus + 1 })}
            </span>
          </>
        ) : (
          <p className="mandala-hint">{t('mandala.mobile.hint')}</p>
        )}
      </div>
      <MandalaBlock
        key={focus === null ? 'center' : `dir-${focus}`}
        className="mandala-block--mobile"
        mandala={mandala}
        focus={focus}
        todayKey={todayKey}
        distanceOf={blockDistance}
        onCellClick={handleCell}
      />
    </div>
  )
}
