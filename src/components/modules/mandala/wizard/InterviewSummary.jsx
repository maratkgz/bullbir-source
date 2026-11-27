import { useMemo, useState } from 'react'
import { LayoutGrid, RotateCcw } from 'lucide-react'
import Icon from '../../../ui/Icon'
import { useLang } from '../../../../context/LangContext'
import { classifyGoal } from '../../../../ai/engine/classifier'
import { LIMITS, TIME_PER_DAY, INTERVIEW_FIELDS, cleanTimePerDay } from '../mandalaModel'
import SpherePicker from '../SpherePicker'

const LONG_FIELDS = INTERVIEW_FIELDS.filter((f) => f !== 'goal')

/** Final editable summary of the interview; "Build my table" hands it back with the chosen sphere. */
export default function InterviewSummary({ summary, domains, feedback, isBusy, onBuild, onRestart }) {
  const { t } = useLang()
  const [form, setForm] = useState(() => ({ ...summary, goal: summary.goal.slice(0, LIMITS.text) }))
  const [sphere, setSphere] = useState(summary.sphere)
  const set = (change) => setForm((f) => ({ ...f, ...change }))

  const ranked = useMemo(() => classifyGoal(form.goal, domains, { feedback }), [form.goal, domains, feedback])
  const sphereId = domains.some((d) => d.id === sphere) ? sphere : ranked[0]?.id || domains[0]?.id
  const canBuild = form.goal.trim().length > 0 && !!sphereId && !isBusy

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canBuild) return
    onBuild({ ...form, minutesPerDay: cleanTimePerDay(form.minutesPerDay), sphere: sphereId })
  }

  return (
    <form className="iv-summary card mandala-editor" onSubmit={handleSubmit}>
      <div>
        <h3>{t('mandala.wizard.summaryTitle')}</h3>
        <p className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>{t('mandala.wizard.summaryHint')}</p>
      </div>

      <label className="mandala-field">
        <span>{t('mandala.wizard.field.goal')}</span>
        <input className="input" value={form.goal} maxLength={LIMITS.text} required
          onChange={(e) => set({ goal: e.target.value })} />
      </label>

      {LONG_FIELDS.map((field) => (
        <label key={field} className="mandala-field">
          <span>{t(`mandala.wizard.field.${field}`)}</span>
          <textarea className="input" rows={2} value={form[field]} maxLength={LIMITS.answer}
            onChange={(e) => set({ [field]: e.target.value })} />
        </label>
      ))}

      <label className="mandala-field mandala-field--inline">
        <span>{t('mandala.wizard.field.minutes')}</span>
        <input type="number" className="input" min={TIME_PER_DAY.min} max={TIME_PER_DAY.max} step={5}
          value={form.minutesPerDay} onChange={(e) => set({ minutesPerDay: e.target.value })} />
      </label>

      {sphereId && (
        <SpherePicker domains={domains} ranked={ranked} value={sphereId} onChange={setSphere}
          label={t('mandala.wizard.sphere')} />
      )}

      <div className="flex gap-3 justify-between">
        <button type="button" className="btn btn-ghost" onClick={onRestart}>
          <Icon icon={RotateCcw} size="1em" /> {t('mandala.wizard.restart')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!canBuild}>
          <Icon icon={LayoutGrid} size="1em" /> {t('mandala.wizard.build')}
        </button>
      </div>
    </form>
  )
}
