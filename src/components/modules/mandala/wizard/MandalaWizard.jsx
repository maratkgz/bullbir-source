import { useState } from 'react'
import { Heart } from 'lucide-react'
import Icon from '../../../ui/Icon'
import { useLang } from '../../../../context/LangContext'
import { useAiLibrary } from '../../../../ai/useAiLibrary'
import { useAiState } from '../../../../ai/useAiState'
import { checkSafety, stopsPlanning } from '../../../../ai/engine/safety'
import { mandalaFromDomain } from '../../../../ai/engine/mandalaGenerator'
import { INTERVIEW_FIELDS, withInterview } from '../mandalaModel'
import { startInterview, submitAnswer, resumeInterview } from './interviewFlow'
import InterviewChat from './InterviewChat'
import InterviewSummary from './InterviewSummary'
import './Wizard.css'

function SafetyStop({ messageKey, onBack, onExit, t }) {
  return (
    <div className="iv-safety card" role="alert">
      <span className="iv-safety-icon"><Icon icon={Heart} size={22} /></span>
      <h3>{t('mandala.wizard.safetyTitle')}</h3>
      <p>{t(messageKey)}</p>
      <div className="flex gap-3 justify-between">
        <button type="button" className="btn btn-ghost" onClick={onExit}>{t('mandala.wizard.safetyExit')}</button>
        <button type="button" className="btn btn-primary" onClick={onBack}>{t('mandala.wizard.safetyBack')}</button>
      </div>
    </div>
  )
}

/**
 * "Create your table": interview (one question at a time) → editable summary → table.
 * `onCreate(doc)` receives a complete new mandala document; `onManual` opens the empty-table form.
 */
export default function MandalaWizard({ onCreate, onManual, onCancel, isBusy }) {
  const { t, lang } = useLang()
  const { domains } = useAiLibrary()
  const { feedback, rememberChoice } = useAiState()
  const [state, setState] = useState(() => startInterview({ domains }))

  const handleAnswer = (text) => setState((s) => submitAnswer(s, text, { domains }))
  const handleResume = () => setState((s) => resumeInterview(s, { domains }))
  const handleRestart = () => setState(startInterview({ domains }))

  const handleBuild = (summary) => {
    const edited = checkSafety(INTERVIEW_FIELDS.map((f) => summary[f]).join(' \n '))
    if (stopsPlanning(edited.level)) {
      setState((s) => ({ ...s, phase: 'safety', safetyKey: edited.key }))
      return
    }
    const domain = domains.find((d) => d.id === summary.sphere) || domains[0]
    if (!domain) return
    const goal = summary.goal.trim()
    const doc = withInterview(mandalaFromDomain(domain, goal, lang), { ...summary, goal, sphere: domain.id })
    onCreate(doc)
    rememberChoice(goal, domain.id).catch(() => {}) // learning is best-effort
  }

  if (!domains.length) return <p className="text-secondary">{t('ai.noLibrary')}</p>

  return (
    <div className="iv-wizard">
      {state.phase === 'chat' && <InterviewChat state={state} onSubmit={handleAnswer} onManual={onManual} />}
      {state.phase === 'safety' && (
        <SafetyStop messageKey={state.safetyKey} onBack={handleResume} onExit={onCancel} t={t} />
      )}
      {state.phase === 'summary' && (
        <InterviewSummary
          summary={state.summary}
          domains={domains}
          feedback={feedback}
          isBusy={isBusy}
          onBuild={handleBuild}
          onRestart={handleRestart}
        />
      )}
    </div>
  )
}
