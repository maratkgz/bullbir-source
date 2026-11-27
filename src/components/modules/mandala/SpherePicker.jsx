import { useLang } from '../../../context/LangContext'
import { pick } from '../../../ai/library/schema'

const SUGGESTIONS_SHOWN = 3

/**
 * Sphere (library domain) choice: the top classifier matches as chips + a full select.
 * @param {{ domains: object[], ranked: Array<{ id, isFallback? }>, value: string, onChange: (id) => void, label?: string }} props
 */
export default function SpherePicker({ domains, ranked, value, onChange, label }) {
  const { t, lang } = useLang()
  const top = ranked.slice(0, SUGGESTIONS_SHOWN).map((r) => domains.find((d) => d.id === r.id)).filter(Boolean)

  return (
    <div className="mandala-field">
      <span>{label || t('ai.fill.suggested')}</span>
      <div className="ai-chips">
        {top.map((d, i) => (
          <button
            key={d.id}
            type="button"
            className={`ai-chip${d.id === value ? ' is-active' : ''}`}
            aria-pressed={d.id === value}
            onClick={() => onChange(d.id)}
          >
            <span aria-hidden="true">{d.icon}</span> {pick(d.title, lang)}
            {i === 0 && !ranked[0].isFallback && <span className="ai-chip-badge">{t('ai.fill.best')}</span>}
          </button>
        ))}
      </div>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('ai.fill.allSpheres')}>
        {domains.map((d) => <option key={d.id} value={d.id}>{d.icon} {pick(d.title, lang)}</option>)}
      </select>
    </div>
  )
}
