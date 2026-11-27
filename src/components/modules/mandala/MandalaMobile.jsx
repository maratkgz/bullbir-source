import { useState } from 'react'
import { useLang } from '../../../context/LangContext'
import DirectionTiles from './DirectionTiles'
import DirectionSheet from './DirectionSheet'
import ActionList from './ActionList'

/**
 * Phones (< 600px): the centre 3×3 only — goal + 8 direction tiles. Tapping a direction opens a
 * bottom sheet with its 8 actions. The sheet hides while the cell editor is open (`isEditing`)
 * and comes back when it closes.
 */
export function MandalaPhone({ mandala, todayKey, isEditing, onOpen, onToggle }) {
  const { t } = useLang()
  const [sheetDir, setSheetDir] = useState(null)

  return (
    <div className="mandala-phone">
      <p className="mandala-hint">{t('mandala.mobile.hint')}</p>
      <DirectionTiles mandala={mandala} onSelect={setSheetDir} onOpenGoal={() => onOpen({ kind: 'center' })} />
      <DirectionSheet
        mandala={mandala}
        d={sheetDir}
        isOpen={sheetDir !== null && !isEditing}
        todayKey={todayKey}
        onClose={() => setSheetDir(null)}
        onToggle={onToggle}
        onEdit={onOpen}
      />
    </div>
  )
}

/** Tablets (600–899px): centre 3×3 on the left, the selected direction's actions on the right. */
export function MandalaTablet({ mandala, todayKey, onOpen, onToggle }) {
  const { t } = useLang()
  const [selected, setSelected] = useState(0)

  return (
    <>
      <p className="mandala-hint">{t('mandala.tablet.hint')}</p>
      <div className="mandala-split">
        <DirectionTiles
          mandala={mandala}
          selected={selected}
          onSelect={setSelected}
          onOpenGoal={() => onOpen({ kind: 'center' })}
        />
        <ActionList
          key={selected}
          mandala={mandala}
          d={selected}
          todayKey={todayKey}
          onToggle={onToggle}
          onEdit={onOpen}
          headingId="mandala-split-title"
        />
      </div>
    </>
  )
}
