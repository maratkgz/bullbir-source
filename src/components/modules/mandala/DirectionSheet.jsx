import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import Icon from '../../ui/Icon'
import { useLang } from '../../../context/LangContext'
import { DIRECTION_COLORS } from './mandalaModel'
import { directionCount } from './gridLayout'
import ActionList from './ActionList'

const CLOSE_OFFSET = 100 // px dragged down that closes the sheet
const CLOSE_VELOCITY = 500 // px/s flick that closes it even when the drag was short

/** Escape closes; the page behind doesn't scroll while the sheet is open. */
function useSheetEffects(isOpen, onClose, focusRef) {
  // Latest onClose without re-running the effect (which would steal focus) on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    focusRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [isOpen, focusRef])
}

/**
 * Phone bottom sheet with one direction's 8 actions. Drag the handle/header down (or flick) to
 * close; the close button and Esc close it too. Only the header starts a drag, so the list scrolls.
 */
export default function DirectionSheet({ mandala, d, isOpen, todayKey, onClose, onToggle, onEdit }) {
  const { t } = useLang()
  const reduceMotion = useReducedMotion()
  const dragControls = useDragControls()
  const closeRef = useRef(null)
  const titleId = useId()
  useSheetEffects(isOpen, onClose, closeRef)

  const dir = d === null ? null : mandala.directions[d]
  const slide = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }

  const handleDragEnd = (_, info) => {
    if (info.offset.y > CLOSE_OFFSET || info.velocity.y > CLOSE_VELOCITY) onClose()
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && dir && (
        <motion.div
          className="mandala-sheet-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="mandala-sheet"
            style={{ '--c': DIRECTION_COLORS[d] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={handleDragEnd}
            {...slide}
          >
            <div className="mandala-sheet-head" onPointerDown={(e) => dragControls.start(e)}>
              <span className="mandala-sheet-handle" aria-hidden="true" />
              <div className="mandala-sheet-titlebar">
                <div className="mandala-sheet-heading">
                  <h3 id={titleId}>{dir.text.trim() || t('mandala.direction', { n: d + 1 })}</h3>
                  <span>{t('mandala.tile.progress', directionCount(dir))}</span>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={onClose}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={t('common.close')}
                >
                  <Icon icon={X} />
                </button>
              </div>
            </div>
            <div className="mandala-sheet-body">
              <ActionList
                mandala={mandala}
                d={d}
                todayKey={todayKey}
                onToggle={onToggle}
                onEdit={onEdit}
                showHeader={false}
                headingId={titleId}
              />
              <button type="button" className="btn btn-secondary mandala-sheet-dir-edit" onClick={() => onEdit({ kind: 'direction', d })}>
                {t('mandala.list.editDirection')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
