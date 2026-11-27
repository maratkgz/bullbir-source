import { useState } from 'react'
import { useLang } from '../../../context/LangContext'
import { LIMITS, normalizeCell } from './mandalaModel'
import { ITEM_TYPES, FREQS } from '../../../ai/library/schema'
import { RefreshCw, Feather } from 'lucide-react'
import Icon from '../../ui/Icon'

const newId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function MilestoneList({ milestones, onChange, t }) {
  const [draft, setDraft] = useState('')
  const canAdd = draft.trim() && milestones.length < LIMITS.milestones

  const add = () => {
    if (!canAdd) return
    onChange([...milestones, { id: newId(), text: draft.trim(), done: false, deadline: '' }])
    setDraft('')
  }
  const patch = (id, change) =>
    onChange(milestones.map((m) => (m.id === id ? { ...m, ...change } : m)))
  const removeOne = (id) => onChange(milestones.filter((m) => m.id !== id))

  return (
    <div className="mandala-ms">
      {milestones.map((m) => (
        <div key={m.id} className={`mandala-ms-row${m.done ? ' is-done' : ''}`}>
          <input
            type="checkbox"
            checked={m.done}
            onChange={(e) => patch(m.id, { done: e.target.checked })}
            aria-label={t('mandala.msDone')}
          />
          <span className="mandala-ms-text">{m.text}</span>
          <input
            type="date"
            className="input mandala-ms-date"
            value={m.deadline}
            onChange={(e) => patch(m.id, { deadline: e.target.value })}
            aria-label={t('mandala.deadline')}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeOne(m.id)} aria-label={t('common.delete')}>
            ✕
          </button>
        </div>
      ))}
      <div className="mandala-ms-add">
        <input
          className="input"
          value={draft}
          maxLength={LIMITS.milestoneText}
          placeholder={t('mandala.msPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button type="button" className="btn btn-secondary" onClick={add} disabled={!canAdd}>+</button>
      </div>
    </div>
  )
}

function TypeFields({ form, set, t }) {
  const setType = (type) => set({ type, freq: type === 'habit' ? form.freq || 'daily' : '' })
  return (
    <div className="mandala-field-row">
      <label className="mandala-field mandala-field--inline">
        <span>{t('mandala.type.label')}</span>
        <select className="select" value={form.type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t('mandala.type.none')}</option>
          {ITEM_TYPES.map((type) => <option key={type} value={type}>{t(`mandala.type.${type}`)}</option>)}
        </select>
      </label>
      {form.type === 'habit' && (
        <label className="mandala-field mandala-field--inline">
          <span>{t('mandala.freq.label')}</span>
          <select className="select" value={form.freq || 'daily'} onChange={(e) => set({ freq: e.target.value })}>
            {FREQS.map((freq) => <option key={freq} value={freq}>{t(`mandala.freq.${freq}`)}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}

/** "Not for me" / "Too hard": asks the coach for another suggestion (never for done cells). */
function RegenerateButtons({ isDone, isBusy, onRegenerate, t }) {
  return (
    <div className="mandala-field">
      <span>{t('mandala.regen.title')}</span>
      <div className="mandala-regen">
        <button type="button" className="btn btn-secondary btn-sm" disabled={isDone || isBusy}
          onClick={() => onRegenerate('not_me')}>
          <Icon icon={RefreshCw} size="1em" /> {t('mandala.regen.notMe')}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={isDone || isBusy}
          onClick={() => onRegenerate('too_hard')}>
          <Icon icon={Feather} size="1em" /> {t('mandala.regen.tooHard')}
        </button>
      </div>
      {isDone && <p className="mandala-regen-note">{t('mandala.regen.doneLocked')}</p>}
    </div>
  )
}

/** Edits one mandala cell. Parent should pass `key` so state resets per cell. */
export default function CellEditor({ cell, kind, onSave, onCancel, isSaving, onRegenerate }) {
  const { t } = useLang()
  const [form, setForm] = useState(() => normalizeCell(cell))
  const set = (change) => setForm((f) => ({ ...f, ...change }))

  const textLabel = {
    center: t('mandala.mainGoal'),
    direction: t('mandala.directionLabel'),
    action: t('mandala.actionLabel'),
  }[kind]
  const doneLabel = kind === 'center' ? t('mandala.goalAchieved') : t('mandala.markDone')

  const submit = (e) => {
    e.preventDefault()
    if (kind === 'center' && !form.text.trim()) return
    onSave(form)
  }

  return (
    <form className="mandala-editor" onSubmit={submit}>
      <label className="mandala-field">
        <span>{textLabel}</span>
        <input
          className="input"
          autoFocus
          value={form.text}
          maxLength={LIMITS.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder={t(`mandala.placeholder.${kind}`)}
        />
      </label>

      {kind === 'action' && <TypeFields form={form} set={set} t={t} />}

      {onRegenerate && kind !== 'center' && (
        <RegenerateButtons isDone={cell.done} isBusy={isSaving} onRegenerate={onRegenerate} t={t} />
      )}

      <div className="mandala-field-row">
        <label className="mandala-check">
          <input type="checkbox" checked={form.done} onChange={(e) => set({ done: e.target.checked })} />
          <span>{doneLabel}</span>
        </label>
        <label className="mandala-field mandala-field--inline">
          <span>{t('mandala.deadline')}</span>
          <input type="date" className="input" value={form.deadline} onChange={(e) => set({ deadline: e.target.value })} />
        </label>
      </div>

      <div className="mandala-field">
        <span>{t('mandala.milestones')}</span>
        <MilestoneList milestones={form.milestones} onChange={(milestones) => set({ milestones })} t={t} />
      </div>

      <label className="mandala-field">
        <span>{t('mandala.note')}</span>
        <textarea
          className="input"
          rows={3}
          value={form.note}
          maxLength={LIMITS.note}
          onChange={(e) => set({ note: e.target.value })}
          placeholder={t('mandala.notePlaceholder')}
        />
      </label>

      <div className="flex gap-3 justify-between">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={isSaving || (kind === 'center' && !form.text.trim())}>
          {t('common.save')}
        </button>
      </div>
    </form>
  )
}
