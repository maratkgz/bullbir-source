import { useMemo, useRef, useState } from 'react'
import { useLang } from '../../../context/LangContext'
import { useToast } from '../../ui/Toast'
import { useCollection } from '../../../hooks/useCollection'
import { useAiLibrary } from '../../../ai/useAiLibrary'
import { buildLaunch, withLinkedIds, dayBudget } from '../../../ai/engine/launchPlan'
import { toDateKey } from '../../../utils/format'
import { CalendarDays, Repeat, Rocket, Sparkles } from 'lucide-react'
import Icon from '../../ui/Icon'

const PREVIEW_ROWS = 8

/** Writes the launch docs; returns the { d, a, id } links of everything created. */
async function writeLaunch(launch, addHabit, addTask) {
  const jobs = [...launch.habits.map((data) => ({ add: addHabit, data })), ...launch.tasks.map((data) => ({ add: addTask, data }))]
  const links = []
  for (const { add, data } of jobs) {
    const id = await add(data) // add() resolves at once with the local id; writes confirm in background
    if (id) links.push({ d: data.mandalaRef.d, a: data.mandalaRef.a, id })
  }
  return links
}

function Counts({ launch, t }) {
  return (
    <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
      <span className="badge"><Icon icon={Repeat} size="1em" /> {t('launch.habits', { n: launch.habits.length })}</span>
      <span className="badge"><Icon icon={CalendarDays} size="1em" /> {t('launch.tasks', { n: launch.tasks.length, days: launch.days })}</span>
      <span className="badge"><Icon icon={Sparkles} size="1em" /> {t('launch.qualities', { n: launch.qualities.length })}</span>
    </div>
  )
}

function Preview({ launch, t }) {
  const more = (n) => n > PREVIEW_ROWS && <li className="text-secondary">{t('launch.more', { n: n - PREVIEW_ROWS })}</li>
  return (
    <>
      {launch.tasks.length > 0 && (
        <section>
          <h4 style={{ marginBottom: 'var(--space-2)' }}>{t('launch.schedule')}</h4>
          <ul className="ai-plan-preview">
            {launch.tasks.slice(0, PREVIEW_ROWS).map((task) => (
              <li key={`${task.mandalaRef.d}-${task.mandalaRef.a}-${task.step}`}>
                <span className="ai-plan-date">{task.deadline}</span>
                <span className="ai-plan-title">{task.title}</span>
                <span className="ai-plan-date">{t('launch.minutes', { n: task.minutes })}</span>
              </li>
            ))}
            {more(launch.tasks.length)}
          </ul>
        </section>
      )}
      {launch.habits.length > 0 && (
        <section>
          <h4 style={{ marginBottom: 'var(--space-2)' }}>{t('launch.habitsList')}</h4>
          <ul className="ai-plan-preview">
            {launch.habits.slice(0, PREVIEW_ROWS).map((h) => (
              <li key={`${h.mandalaRef.d}-${h.mandalaRef.a}`}>
                <span aria-hidden="true">{h.emoji}</span>
                <span className="ai-plan-title">{h.title}</span>
                <span className="ai-plan-date">{t(`launch.freq.${h.freq}`)}</span>
              </li>
            ))}
            {more(launch.habits.length)}
          </ul>
        </section>
      )}
      {launch.qualities.length > 0 && (
        <section>
          <h4 style={{ marginBottom: 'var(--space-2)' }}>{t('launch.qualitiesList')}</h4>
          <ul className="ai-plan-preview">
            {launch.qualities.slice(0, PREVIEW_ROWS).map((q) => (
              <li key={`${q.d}-${q.a}`}><span className="ai-plan-title">{q.text}</span></li>
            ))}
            {more(launch.qualities.length)}
          </ul>
        </section>
      )}
    </>
  )
}

/** "Launch plan": turns the mandala into habits + dated step tasks and marks it active. */
export default function MandalaPlanner({ mandala, onDone, onCancel }) {
  const { t, lang } = useLang()
  const toast = useToast()
  const { domains } = useAiLibrary()
  const { items: tasks, loading: tasksLoading, add: addTask } = useCollection('tasks')
  const { items: habits, loading: habitsLoading, add: addHabit } = useCollection('habits')
  const { update: updateMandala } = useCollection('mandalas')
  const [isSaving, setIsSaving] = useState(false)
  const busyRef = useRef(false) // blocks a second tap before React re-renders the disabled button
  const loading = tasksLoading || habitsLoading

  const launch = useMemo(
    () => buildLaunch(mandala, { today: toDateKey(), lang, domains, existingTasks: tasks, existingHabits: habits }),
    [mandala, lang, domains, tasks, habits],
  )
  const created = launch.habits.length + launch.tasks.length
  const nothingToDo = created === 0 && launch.qualities.length === 0

  const start = async () => {
    if (busyRef.current || loading || nothingToDo) return
    busyRef.current = true
    setIsSaving(true)
    try {
      const links = await writeLaunch(launch, addHabit, addTask)
      await updateMandala(mandala.id, { directions: withLinkedIds(mandala, links), status: 'active' })
      onDone(created)
    } catch {
      toast.error(t('launch.failed'))
    } finally {
      busyRef.current = false
      setIsSaving(false)
    }
  }

  return (
    <div className="mandala-editor">
      <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>{t('launch.intro', { m: dayBudget(mandala) })}</p>
      {loading ? (
        <p className="text-secondary">{t('launch.loading')}</p>
      ) : nothingToDo ? (
        <p className="text-secondary">{t('launch.empty')}</p>
      ) : (
        <>
          <Counts launch={launch} t={t} />
          <Preview launch={launch} t={t} />
        </>
      )}
      {!loading && launch.skipped > 0 && (
        <p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{t('launch.skipped', { n: launch.skipped })}</p>
      )}

      <div className="flex gap-3 justify-between">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={start} disabled={isSaving || loading || nothingToDo} aria-busy={isSaving}>
          <Icon icon={Rocket} size="1em" /> {isSaving ? t('launch.busy') : t('launch.button')}
        </button>
      </div>
    </div>
  )
}
