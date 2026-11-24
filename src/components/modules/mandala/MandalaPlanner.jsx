import { useMemo, useState } from 'react'
import { useLang } from '../../../context/LangContext'
import { useCollection } from '../../../hooks/useCollection'
import { planTasks, PLAN_LIMITS } from '../../../ai/engine/planner'
import { toDateKey } from '../../../utils/format'
import { CalendarDays } from 'lucide-react'
import Icon from '../../ui/Icon'

const DEFAULT_WEEKS = 4
const DEFAULT_PER_WEEK = 5
const PREVIEW_ROWS = 12

/** Turns open mandala actions into dated tasks in the Tasks module. */
export default function MandalaPlanner({ mandala, onDone, onCancel }) {
  const { t } = useLang()
  const { items: tasks, add } = useCollection('tasks')
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS)
  const [perWeek, setPerWeek] = useState(DEFAULT_PER_WEEK)
  const [startDate, setStartDate] = useState(() => toDateKey())
  const [isSaving, setIsSaving] = useState(false)

  const plan = useMemo(
    () => planTasks(mandala, { startDate, weeks, perWeek, existingTasks: tasks }),
    [mandala, startDate, weeks, perWeek, tasks],
  )

  const save = async () => {
    setIsSaving(true)
    try {
      for (const task of plan) await add(task) // sequential: keeps order and stays within write limits
      onDone(plan.length)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="mandala-editor">
      <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>{t('ai.plan.intro')}</p>
      <div className="mandala-field-row">
        <label className="mandala-field mandala-field--inline">
          <span>{t('ai.plan.start')}</span>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="mandala-field mandala-field--inline">
          <span>{t('ai.plan.weeks')}</span>
          <input type="number" className="input" min={1} max={PLAN_LIMITS.maxWeeks} value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))} />
        </label>
        <label className="mandala-field mandala-field--inline">
          <span>{t('ai.plan.perWeek')}</span>
          <input type="number" className="input" min={1} max={PLAN_LIMITS.maxPerWeek} value={perWeek}
            onChange={(e) => setPerWeek(Number(e.target.value))} />
        </label>
      </div>

      {plan.length === 0 ? (
        <p className="text-secondary">{t('ai.plan.empty')}</p>
      ) : (
        <ul className="ai-plan-preview">
          {plan.slice(0, PREVIEW_ROWS).map((task, i) => (
            <li key={`${task.mandalaRef.d}-${task.mandalaRef.a}`}>
              <span className="ai-plan-date">{task.deadline}</span>
              <span className="ai-plan-title">{task.title}</span>
              {i < perWeek && <span className="ai-chip-badge">{t('ai.plan.thisWeek')}</span>}
            </li>
          ))}
          {plan.length > PREVIEW_ROWS && <li className="text-secondary">{t('ai.plan.more', { n: plan.length - PREVIEW_ROWS })}</li>}
        </ul>
      )}

      <div className="flex gap-3 justify-between">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={isSaving || plan.length === 0}>
          <Icon icon={CalendarDays} size="1em" /> {t('ai.plan.add', { n: plan.length })}
        </button>
      </div>
    </div>
  )
}
