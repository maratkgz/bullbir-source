import { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import Icon from '../../ui/Icon'

/**
 * "⋯" button with a small popup menu. Closes on outside click/tap, Esc (focus returns to the
 * button) and after choosing an item.
 * @param {{ label: string, items: Array<{ id, label, icon?, danger?, onSelect }> }} props
 */
export default function OverflowMenu({ label, items }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    rootRef.current?.querySelector('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (item) => {
    setOpen(false)
    item.onSelect()
  }

  return (
    <div className="mandala-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-icon mandala-menu-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={MoreHorizontal} />
      </button>
      {open && (
        <div className="mandala-menu-list" role="menu" id={menuId} aria-label={label}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`mandala-menu-item${item.danger ? ' is-danger' : ''}`}
              onClick={() => choose(item)}
            >
              {item.icon && <Icon icon={item.icon} size="1em" />}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
