import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import Icon from '../../ui/Icon'

/**
 * The whole cover is the control — no buttons drawn over the photo. Tap it: without a cover the
 * photo picker opens; with a cover a tiny menu offers "change" / "remove".
 */
export default function CoverMenu({ hasCover, busy, onChange, onRemove, t }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (fn) => () => { setOpen(false); fn() }

  return (
    <div className="prof-cover-menu" ref={rootRef}>
      <button type="button" className="prof-cover-hit" disabled={busy}
        aria-label={t('profile.banner.change')} aria-haspopup={hasCover ? 'menu' : undefined}
        aria-expanded={hasCover ? open : undefined}
        onClick={hasCover ? () => setOpen((v) => !v) : onChange}>
        {busy && <span className="spinner prof-cover-spin" aria-hidden="true" />}
      </button>
      {open && (
        <div className="prof-cover-pop" role="menu">
          <button type="button" role="menuitem" onClick={choose(onChange)}>
            <Icon icon={ImagePlus} size={16} /> {t('profile.banner.change')}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={choose(onRemove)}>
            <Icon icon={Trash2} size={16} /> {t('profile.banner.remove')}
          </button>
        </div>
      )}
    </div>
  )
}
