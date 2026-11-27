import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import './BottomSheet.css'

const CLOSE_DISTANCE = 120
const CLOSE_VELOCITY = 600

/**
 * Phone dialog that slides up from the bottom. Swipe-to-close starts only from the header
 * (handle + title), so the body keeps normal touch scrolling for long forms.
 */
export default function BottomSheet({ open, onClose, title, children }) {
  const dragControls = useDragControls()

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > CLOSE_DISTANCE || info.velocity.y > CLOSE_VELOCITY) onClose()
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="sheet-header" onPointerDown={(e) => dragControls.start(e)}>
              <div className="sheet-handle" />
              {title && <h3 className="sheet-title">{title}</h3>}
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
