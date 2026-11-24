import { useMemo, useState } from 'react'
import { useLang } from '../../context/LangContext'
import { LANGS, SLOTS, validateDomain } from '../../ai/library/schema'
import { readJsonFile, downloadJson, cleanEntry } from './adminIo'

const MAX_MILESTONES = 4
const blank = () => ({ en: '', kg: '', ru: '' })

export function emptyDomain() {
  return {
    id: '',
    icon: '🎯',
    title: blank(),
    keywords: { en: [], kg: [], ru: [] },
    directions: Array.from({ length: SLOTS }, () => ({ title: blank(), milestones: [], actions: Array.from({ length: SLOTS }, blank) })),
  }
}

/** Three inputs (EN / KG / RU) for one localized string. */
function Tri({ value, onChange, placeholder }) {
  return (
    <div className="ai-tri">
      {LANGS.map((l) => (
        <input key={l} className="input" value={value?.[l] || ''} placeholder={`${l.toUpperCase()} ${placeholder || ''}`}
          onChange={(e) => onChange({ ...value, [l]: e.target.value })} />
      ))}
    </div>
  )
}

const setAt = (list, i, item) => list.map((x, j) => (j === i ? item : x))

/** Structured editor for one library domain (8 directions × 8 actions × 3 languages). */
export default function DomainEditor({ initial, isNew, onSave, onCancel, isSaving }) {
  const { t } = useLang()
  const [domain, setDomain] = useState(() => structuredClone(cleanEntry(initial)))
  const [d, setD] = useState(0)
  const [importError, setImportError] = useState('')
  const errors = useMemo(() => validateDomain(domain), [domain])
  const dir = domain.directions[d]

  const patchDir = (change) => setDomain((x) => ({ ...x, directions: setAt(x.directions, d, { ...x.directions[d], ...change }) }))
  const setKeywords = (l, text) => setDomain((x) => ({
    ...x, keywords: { ...x.keywords, [l]: text.split(',').map((s) => s.trim()).filter(Boolean) },
  }))

  const importFile = async (file) => {
    try {
      const data = await readJsonFile(file)
      setDomain({ ...emptyDomain(), ...data, id: isNew ? data.id || '' : domain.id })
      setImportError('')
    } catch (e) {
      setImportError(e.message)
    }
  }

  return (
    <div className="mandala-editor">
      <div className="mandala-field-row">
        <label className="mandala-field mandala-field--inline">
          <span>ID</span>
          <input className="input" value={domain.id} disabled={!isNew} placeholder="cooking"
            onChange={(e) => setDomain((x) => ({ ...x, id: e.target.value.toLowerCase() }))} />
        </label>
        <label className="mandala-field" style={{ width: 90 }}>
          <span>{t('ai.admin.icon')}</span>
          <input className="input" value={domain.icon} maxLength={4} onChange={(e) => setDomain((x) => ({ ...x, icon: e.target.value }))} />
        </label>
      </div>

      <div className="mandala-field"><span>{t('ai.admin.name')}</span>
        <Tri value={domain.title} onChange={(title) => setDomain((x) => ({ ...x, title }))} />
      </div>

      <div className="mandala-field"><span>{t('ai.admin.keywords')}</span>
        <div className="ai-tri">
          {LANGS.map((l) => (
            <textarea key={l} className="input" rows={2} defaultValue={(domain.keywords?.[l] || []).join(', ')}
              placeholder={`${l.toUpperCase()}: word, !decisive word`} onBlur={(e) => setKeywords(l, e.target.value)} />
          ))}
        </div>
      </div>

      <div className="ai-chips" role="tablist">
        {domain.directions.map((x, i) => (
          <button key={i} type="button" className={`ai-chip${i === d ? ' is-active' : ''}`} onClick={() => setD(i)}>
            {i + 1}. {x.title?.ru || x.title?.en || '—'}
          </button>
        ))}
      </div>

      <div className="mandala-field"><span>{t('mandala.direction', { n: d + 1 })}</span>
        <Tri value={dir.title} onChange={(title) => patchDir({ title })} />
      </div>

      <div className="mandala-field"><span>{t('mandala.milestones')}</span>
        {(dir.milestones || []).map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1 }}><Tri value={m} onChange={(v) => patchDir({ milestones: setAt(dir.milestones, i, v) })} /></div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => patchDir({ milestones: dir.milestones.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        {(dir.milestones || []).length < MAX_MILESTONES && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => patchDir({ milestones: [...(dir.milestones || []), blank()] })}>
            + {t('mandala.milestones')}
          </button>
        )}
      </div>

      <div className="mandala-field"><span>{t('ai.admin.actions')}</span>
        {dir.actions.map((a, i) => (
          <Tri key={i} value={a} placeholder={`#${i + 1}`} onChange={(v) => patchDir({ actions: setAt(dir.actions, i, v) })} />
        ))}
      </div>

      {errors.length > 0 && (
        <details open>
          <summary className="text-secondary">{t('ai.admin.errors', { n: errors.length })}</summary>
          <ul className="ai-errors">{errors.slice(0, 30).map((e) => <li key={e}>{e}</li>)}</ul>
        </details>
      )}
      {importError && <p className="ai-errors">{importError}</p>}

      <div className="flex gap-3 justify-between" style={{ flexWrap: 'wrap' }}>
        <div className="flex gap-3">
          <label className="btn btn-ghost btn-sm">
            {t('ai.admin.import')}
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadJson(`${domain.id || 'domain'}.json`, domain)}>
            {t('ai.admin.export')}
          </button>
        </div>
        <div className="flex gap-3">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={isSaving || errors.length > 0} onClick={() => onSave(domain)}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
