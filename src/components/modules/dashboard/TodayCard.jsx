import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { serverTimestamp } from 'firebase/firestore'
import { CalendarCheck, Check, Clock, Grid3x3, PartyPopper, Sparkles } from 'lucide-react'
import { useCollection } from '../../../hooks/useCollection'
import { useDoc } from '../../../hooks/useDoc'
import { useLang } from '../../../context/LangContext'
import Icon from '../../ui/Icon'
import { DIRECTION_COLORS } from '../mandala/mandalaModel'
import { todayPlan } from '../../../ai/engine/today'
import { pickActiveMandala, toggleCheck, reviewWeekId, shouldShowReviewBanner } from '../../../ai/engine/weekPlan'
import { toDate, toDateKey } from '../../../utils/format'
import QualityChecklist from './QualityChecklist'
import './today.css'

const doneOn = (task, dayKey) => task.status === 'done' && toDate(task.completedAt) && toDateKey(toDate(task.completedAt)) === dayKey

function ReviewBanner({ t, onOpen }) {
  return (
    <div className="card today-banner" role="status">
      <span className="today-banner-icon" aria-hidden="true"><Icon icon={CalendarCheck} /></span>
      <div className="today-banner-body">
        <strong>{t('today.bannerTitle')}</strong>
        <p>{t('today.bannerText')}</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onOpen}>{t('today.bannerBtn')}</button>
    </div>
  )
}

function CheckBox({ on, label, onClick, reduce }) {
  return (
    <motion.button
      type="button"
      className={`today-check ${on ? 'is-on' : ''}`}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.85 }}
    >
      <AnimatePresence initial={false}>
        {on && (
          <motion.span
            key="tick"
            initial={reduce ? { opacity: 0 } : { scale: 0, rotate: -30, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { scale: 1, rotate: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0.1 } : { type: 'spring', stiffness: 520, damping: 22 }}
            style={{ display: 'grid' }}
          >
            <Icon icon={Check} size={16} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

function TaskRow({ row, mandala, t, onToggle, reduce }) {
  const { task, plan } = row
  const d = task.mandalaRef.d
  const done = task.status === 'done'
  return (
    <motion.li
      layout={!reduce}
      className={`today-row ${done ? 'is-done' : ''}`}
      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <CheckBox
        on={done}
        reduce={reduce}
        label={t(done ? 'today.markUndone' : 'today.markDone', { title: task.title })}
        onClick={() => onToggle(task)}
      />
      <div className="today-row-body">
        <div className="today-row-title">{task.title}</div>
        <div className="today-row-sub">
          <span className="today-dot" style={{ background: DIRECTION_COLORS[d] }} aria-hidden="true" />
          <span>{mandala.directions[d]?.text}</span>
          <span aria-hidden="true">·</span>
          <span><Icon icon={Clock} size="1em" /> {t('today.minutes', { n: plan.minutes })}</span>
        </div>
        {!done && <div className="today-why">{t(plan.why.key, plan.why.vars)}</div>}
      </div>
    </motion.li>
  )
}

function CreateCta({ t, onCreate }) {
  return (
    <div className="card today-cta">
      <span className="today-banner-icon" aria-hidden="true"><Icon icon={Grid3x3} /></span>
      <div className="today-cta-body">
        <strong>{t('today.ctaTitle')}</strong>
        <p>{t('today.ctaText')}</p>
      </div>
      <button type="button" className="btn btn-secondary" onClick={onCreate}>{t('today.ctaBtn')}</button>
    </div>
  )
}

/** "My day" block for the Dashboard: review banner, 3 tasks for today, morning quality checklist. */
export default function TodayCard({ today = new Date() }) {
  const { t } = useLang()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const mandalas = useCollection('mandalas')
  const tasks = useCollection('tasks')
  const review = useDoc('weeklyReviews', reviewWeekId(today))
  // Ticked in this session: keeps rows in place while completedAt is still a pending server time.
  const [touched, setTouched] = useState(() => new Set())
  const todayKey = toDateKey(today)

  const mandala = useMemo(() => pickActiveMandala(mandalas.items), [mandalas.items])

  const plan = useMemo(() => {
    if (!mandala) return null
    // Tasks finished today stay in the plan (shown ticked) instead of being replaced.
    const planning = tasks.items.map((task) => (
      task.status === 'done' && (touched.has(task.id) || doneOn(task, todayKey)) ? { ...task, status: 'todo' } : task))
    return todayPlan({ mandalas: [mandala], tasks: planning, minutesPerDay: mandala.timePerDay, today })
  }, [mandala, tasks.items, touched, todayKey, today])

  const rows = useMemo(() => {
    if (!plan) return []
    const byId = new Map(tasks.items.map((task) => [task.id, task]))
    return plan.tasks.map((p) => ({ plan: p, task: byId.get(p.taskId) })).filter((r) => r.task)
  }, [plan, tasks.items])

  if (mandalas.loading || tasks.loading) return null
  const showBanner = !!mandala && !review.loading && shouldShowReviewBanner(today, review.data)

  if (!mandala) {
    return <div className="today-wrap"><CreateCta t={t} onCreate={() => navigate('/app/mandala')} /></div>
  }

  const toggleTask = (task) => {
    if (task.status === 'done') {
      tasks.update(task.id, { status: 'todo', completedAt: null })
      return
    }
    setTouched((prev) => new Set([...prev, task.id]))
    tasks.update(task.id, { status: 'done', completedAt: serverTimestamp() })
  }

  const toggleQuality = (key) => {
    mandalas.update(mandala.id, { checks: toggleCheck(mandala.checks, todayKey, key) })
  }

  const doneCount = rows.filter((r) => r.task.status === 'done').length
  const allDone = rows.length > 0 && doneCount === rows.length

  return (
    <div className="today-wrap">
      {showBanner && <ReviewBanner t={t} onOpen={() => navigate('/app/review')} />}
      <div className="today-grid">
        <section className="card" aria-labelledby="today-title">
          <div className="today-head">
            <h3 id="today-title"><Icon icon={Sparkles} size={18} /> {t('today.tasksTitle')}</h3>
            {rows.length > 0 && (
              <span className="today-meta">
                {t('today.progress', { done: doneCount, total: rows.length, minutes: plan.minutesTotal })}
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <div className="today-empty">
              <p>{t('today.empty')}</p>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/app/review')}>
                {t('today.planCta')}
              </button>
            </div>
          ) : (
            <ul className="today-list">
              {rows.map((row) => (
                <TaskRow key={row.task.id} row={row} mandala={mandala} t={t} onToggle={toggleTask} reduce={reduce} />
              ))}
            </ul>
          )}
          {allDone && (
            <motion.p className="today-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Icon icon={PartyPopper} size="1em" /> {t('today.allDone')}
            </motion.p>
          )}
        </section>
        <QualityChecklist
          qualities={plan.qualities}
          checked={mandala.checks[todayKey] || []}
          onToggle={toggleQuality}
        />
      </div>
    </div>
  )
}
