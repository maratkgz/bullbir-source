import { useMemo, useState } from 'react'
import { useLang } from '../../context/LangContext'
import { LANGS, INSIGHT_KINDS, validateIntent } from '../../ai/library/schema'
import { cleanEntry } from './adminIo'

export function emptyIntent() {
  return { id: '', patterns: { en: [], kg: [], ru: [] }, answers: { en: [], kg: [], ru: [] } }
}

const toLines = (text) => text.split('\n').map((s) => s.trim()).filter(Boolean)

/** One textarea per language; each line is one pattern / one answer variant. */
function LinesTri({ value, onChange, rows }) {
  return (
    <div className="ai-tri">
      {LANGS.map((l) => (
        <textarea key={l} className="input" rows={rows} placeholder={l.toUpperCase()}
          defaultValue={(value?.[l] || []).join('\n')} onBlur={(e) => onChange({ ...value, [l]: toLines(e.target.value) })} />
      ))}
    </div>
  )
}

/** Editor for one coach intent: trigger phrases, answers and an optional live insight. */
export default function IntentEditor({ initial, isNew, onSave, onCancel, isSaving }) {
  const { t } = useLang()
  const [intent, setIntent] = useState(() => structuredClone(cleanEntry(initial)))
  const errors = useMemo(() => validateIntent(intent), [intent])

  return (
    <div className="mandala-editor">
      <div className="mandala-field-row">
        <label className="mandala-field mandala-field--inline">
          <span>ID</span>
          <input className="input" value={intent.id} disabled={!isNew} placeholder="sleep-tips"
            onChange={(e) => setIntent((x) => ({ ...x, id: e.target.value.toLowerCase() }))} />
        </label>
        <label className="mandala-field mandala-field--inline">
          <span>{t('ai.admin.insight')}</span>
          <select className="select" value={intent.insight || ''}
            onChange={(e) => setIntent(({ insight: _drop, ...x }) => (e.target.value ? { ...x, insight: e.target.value } : x))}>
            <option value="">—</option>
            {INSIGHT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      <div className="mandala-field"><span>{t('ai.admin.patterns')}</span>
        <LinesTri rows={4} value={intent.patterns} onChange={(patterns) => setIntent((x) => ({ ...x, patterns }))} />
      </div>
      <div className="mandala-field"><span>{t('ai.admin.answers')}</span>
        <LinesTri rows={5} value={intent.answers} onChange={(answers) => setIntent((x) => ({ ...x, answers }))} />
      </div>
      {errors.length > 0 && <ul className="ai-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex gap-3 justify-between">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={isSaving || errors.length > 0} onClick={() => onSave(intent)}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
