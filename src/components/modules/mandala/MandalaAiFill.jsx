import { useMemo, useState } from 'react'
import { useLang } from '../../../context/LangContext'
import { useAiLibrary } from '../../../ai/useAiLibrary'
import { useAiState } from '../../../ai/useAiState'
import { classifyGoal } from '../../../ai/engine/classifier'
import { mandalaFromDomain } from '../../../ai/engine/mandalaGenerator'
import { pick } from '../../../ai/library/schema'
import { Sparkles } from 'lucide-react'
import Icon from '../../ui/Icon'

const SUGGESTIONS_SHOWN = 3

/**
 * "Fill with AI": picks a library domain for the goal, previews the 8 directions and
 * fills only the EMPTY cells of the mandala (the user's own text is never overwritten).
 */
export default function MandalaAiFill({ mandala, onApply, onCancel, isSaving }) {
  const { t, lang } = useLang()
  const { domains } = useAiLibrary()
  const { feedback, rememberChoice } = useAiState()
  const goal = mandala.center.text || mandala.title

  const ranked = useMemo(() => classifyGoal(goal, domains, { feedback }), [goal, domains, feedback])
  const [domainId, setDomainId] = useState(() => ranked[0]?.id)
  const domain = domains.find((d) => d.id === domainId) || domains[0]
  const top = ranked.slice(0, SUGGESTIONS_SHOWN).map((r) => domains.find((d) => d.id === r.id)).filter(Boolean)

  const apply = async () => {
    const patch = mandalaFromDomain(domain, goal, lang, { existing: mandala })
    await onApply(patch)
    rememberChoice(goal, domain.id).catch(() => {}) // learning is best-effort
  }

  if (!domain) return <p className="text-secondary">{t('ai.noLibrary')}</p>

  return (
    <div className="mandala-editor">
      <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
        {t('ai.fill.intro', { goal })}
      </p>

      <div className="mandala-field">
        <span>{t('ai.fill.suggested')}</span>
        <div className="ai-chips">
          {top.map((d, i) => (
            <button
              key={d.id}
              type="button"
              className={`ai-chip${d.id === domain.id ? ' is-active' : ''}`}
              onClick={() => setDomainId(d.id)}
            >
              <span aria-hidden="true">{d.icon}</span> {pick(d.title, lang)}
              {i === 0 && !ranked[0].isFallback && <span className="ai-chip-badge">{t('ai.fill.best')}</span>}
            </button>
          ))}
        </div>
        <select className="select" value={domain.id} onChange={(e) => setDomainId(e.target.value)} aria-label={t('ai.fill.allSpheres')}>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.icon} {pick(d.title, lang)}</option>)}
        </select>
      </div>

      <div className="mandala-field">
        <span>{t('ai.fill.preview')}</span>
        <ol className="ai-preview">
          {domain.directions.map((dir, i) => (
            <li key={i}>
              <strong>{pick(dir.title, lang)}</strong>
              <span>{pick(dir.actions[0], lang)} · {pick(dir.actions[1], lang)} …</span>
            </li>
          ))}
        </ol>
        <p className="text-secondary" style={{ fontSize: 'var(--text-xs)' }}>{t('ai.fill.keepsYours')}</p>
      </div>

      <div className="flex gap-3 justify-between">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={apply} disabled={isSaving}>
          <Icon icon={Sparkles} size="1em" /> {t('ai.fill.apply')}
        </button>
      </div>
    </div>
  )
}
