import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import Icon from '../../ui/Icon'
import { useLang } from '../../../context/LangContext'
import { LIMITS } from './mandalaModel'

/** The classic "empty table" form: a goal title, optionally followed by "Fill with AI". */
export default function ManualCreate({ onCreate, onCancel }) {
  const { t } = useLang()
  const [title, setTitle] = useState('')
  const [fillWithAi, setFillWithAi] = useState(true)

  const handleSubmit = (e) => {
    e.preventDefault()
    const clean = title.trim()
    if (clean) onCreate(clean, fillWithAi)
  }

  return (
    <form onSubmit={handleSubmit} className="mandala-editor">
      <label className="mandala-field">
        <span>{t('mandala.mainGoal')}</span>
        <input
          className="input"
          autoFocus
          value={title}
          maxLength={LIMITS.text}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('mandala.placeholder.center')}
        />
      </label>
      <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>{t('mandala.createHint')}</p>
      <label className="mandala-check">
        <input type="checkbox" checked={fillWithAi} onChange={(e) => setFillWithAi(e.target.checked)} />
        <span><Icon icon={Sparkles} size="1em" /> {t('ai.fill.onCreate')}</span>
      </label>
      <div className="flex gap-3 justify-between">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={!title.trim()}>{t('common.create')}</button>
      </div>
    </form>
  )
}
