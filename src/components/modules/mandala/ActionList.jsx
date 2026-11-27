import { Pencil } from 'lucide-react'
import Icon from '../../ui/Icon'
import { useLang } from '../../../context/LangContext'
import { DIRECTION_COLORS, isOverdue } from './mandalaModel'
import { TYPE_ICONS } from './MandalaCell'
import { directionCount } from './gridLayout'

function ActionRow({ action, d, a, todayKey, onToggle, onEdit, t }) {
  const text = action.text.trim()
  const isEmpty = !text
  const typeIcon = TYPE_ICONS[action.type]
  const ref = { kind: 'action', d, a }
  const label = t('mandala.action', { n: a + 1 })
  const classes = [
    'mandala-action',
    action.done && 'is-done',
    isEmpty && 'is-empty',
    isOverdue(action, todayKey) && 'is-overdue',
  ].filter(Boolean).join(' ')

  return (
    <li className={classes}>
      <label className="mandala-action-check">
        <input
          type="checkbox"
          checked={action.done}
          disabled={isEmpty}
          onChange={() => onToggle(ref, action)}
          aria-label={t('mandala.list.toggle', { name: text || label })}
        />
      </label>
      <button type="button" className="mandala-action-text" onClick={() => onEdit(ref)}>
        {typeIcon && !isEmpty && (
          <span className="mandala-action-type">
            <Icon icon={typeIcon} size="1em" label={t(`mandala.type.${action.type}`)} />
          </span>
        )}
        <span>{isEmpty ? t('mandala.list.empty') : text}</span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon mandala-action-edit"
        onClick={() => onEdit(ref)}
        aria-label={t('mandala.list.edit', { name: text || label })}
      >
        <Icon icon={Pencil} size={18} />
      </button>
    </li>
  )
}

/**
 * The 8 actions of one direction as a readable list: done checkbox, type icon, text, edit.
 * `onToggle(ref, cell)` flips done; `onEdit(ref)` opens the cell editor.
 * `showHeader` adds the direction name (with its own edit button) and progress.
 */
export default function ActionList({ mandala, d, todayKey, onToggle, onEdit, showHeader = true, headingId }) {
  const { t } = useLang()
  const dir = mandala.directions[d]
  const name = dir.text.trim() || t('mandala.direction', { n: d + 1 })
  const { done, total } = directionCount(dir)

  return (
    <section className="mandala-actions" style={{ '--c': DIRECTION_COLORS[d] }} aria-labelledby={headingId}>
      {showHeader && (
        <div className="mandala-actions-head">
          <h3 id={headingId} className="mandala-actions-title">{name}</h3>
          <span className="mandala-actions-count">{t('mandala.tile.progress', { done, total })}</span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => onEdit({ kind: 'direction', d })}
            aria-label={t('mandala.list.editDirection')}
          >
            <Icon icon={Pencil} size={18} />
          </button>
        </div>
      )}
      <ul className="mandala-action-list">
        {dir.actions.map((action, a) => (
          // Slots are fixed (8 per direction) and never reorder, so the index is a stable key.
          <ActionRow key={a} action={action} d={d} a={a} todayKey={todayKey} onToggle={onToggle} onEdit={onEdit} t={t} />
        ))}
      </ul>
    </section>
  )
}
