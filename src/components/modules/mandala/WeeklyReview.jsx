import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { serverTimestamp } from 'firebase/firestore'
import { ArrowLeft, CalendarDays, CircleCheck, Lightbulb, TriangleAlert, Trophy } from 'lucide-react'
import { useCollection } from '../../../hooks/useCollection'
import { useDoc } from '../../../hooks/useDoc'
import { useLang } from '../../../context/LangContext'
import { useToast } from '../../ui/Toast'
import Icon from '../../ui/Icon'
import { DIRECTION_COLORS } from './mandalaModel'
import { weeklyCoachReview } from '../../../ai/engine/weekly'
import {
  WEEK_PLAN, pickActiveMandala, reviewWeekId, planStartDate, directionStats, buildWeekPlan,
  planTaskOps, buildReviewDoc, nextSundayKey, hasReviewReminder, todayFromSearch,
} from '../../../ai/engine/weekPlan'
import { parseDay } from '../../../ai/engine/dates'
import todayPack from '../../../data/i18n/today'
import '../dashboard/today.css'

const REMINDER_TITLES = Object.values(todayPack).map((dict) => dict['today.reminderTitle'])

function DirectionBars({ stats, t, reduce }) {
  return (
    <section className="card review-section">
      <h3>{t('review.progress')}</h3>
      <div className="review-bars">
        {stats.map((s) => (
          <div key={s.d}>
            <div className="review-bar-head">
              <span><span className="today-dot" style={{ background: DIRECTION_COLORS[s.d] }} aria-hidden="true" />{s.title || t('mandala.direction', { n: s.d + 1 })}</span>
              <span>{s.done}/{s.total} · {s.pct}%</span>
            </div>
            <div className="review-track" role="progressbar" aria-valuenow={s.pct} aria-valuemin={0} aria-valuemax={100} aria-label={s.title}>
              <motion.div
                className="review-fill"
                style={{ background: DIRECTION_COLORS[s.d], transformOrigin: 'left' }}
                initial={{ scaleX: reduce ? s.pct / 100 : 0 }}
                animate={{ scaleX: s.pct / 100 }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ListSection({ title, icon, items, empty, className }) {
  return (
    <section className="card review-section">
      <h3><Icon icon={icon} size={18} /> {title}</h3>
      {items.length === 0 ? <p className="text-muted">{empty}</p> : (
        <ul className={`review-list ${className}`}>
          {items.map((text) => <li key={text}><Icon icon={icon} size={16} /><span>{text}</span></li>)}
        </ul>
      )}
    </section>
  )
}

function PlanDays({ days, lang, t }) {
  const locale = lang === 'en' ? 'en' : lang === 'kg' ? 'ky' : 'ru'
  return (
    <div className="review-days">
      {days.map((day) => (
        <div key={day.date} className="review-day">
          <div className="review-day-name">
            {parseDay(day.date).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' })}
          </div>
          {day.items.length === 0 ? <span className="review-tag">{t('review.restDay')}</span> : (
            <ul>
              {day.items.map((item) => (
                <li key={item.key}>
                  {item.d !== undefined && <span className="today-dot" style={{ background: DIRECTION_COLORS[item.d] }} aria-hidden="true" />}
                  <span>{item.title}</span>
                  {item.taskId && <span className="review-tag">· {t('review.inTasks')}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

/** Sunday weekly review: progress, wins, lagging directions, advice and a confirmable next-week plan. */
export default function WeeklyReview() {
  const { t, lang } = useLang()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const reduce = useReducedMotion()
  const today = useMemo(() => todayFromSearch(location.search, import.meta.env.DEV), [location.search])
  const weekId = reviewWeekId(today)

  const mandalas = useCollection('mandalas')
  const tasks = useCollection('tasks')
  const habits = useCollection('habits', { orderField: 'createdAt', direction: 'asc' })
  const reminders = useCollection('reminders', { orderField: 'date', direction: 'asc' })
  const saved = useDoc('weeklyReviews', weekId)
  const [saving, setSaving] = useState(false)

  const mandala = useMemo(() => pickActiveMandala(mandalas.items), [mandalas.items])
  const review = useMemo(
    () => (mandala ? weeklyCoachReview({ tasks: tasks.items, habits: habits.items, mandalas: [mandala] }, today) : null),
    [mandala, tasks.items, habits.items, today],
  )
  const plan = useMemo(
    () => (mandala && review
      ? buildWeekPlan({ mandala, tasks: tasks.items, lagging: review.lagging, ease: review.ease, startDate: planStartDate(today) })
      : []),
    [mandala, review, tasks.items, today],
  )

  if (mandalas.loading || tasks.loading || saved.loading) {
    return <div className="card review-section"><p className="text-muted">{t('common.loading')}</p></div>
  }

  const header = (
    <div className="page-header">
      <div>
        <h1>{t('review.title')}</h1>
        <p className="text-muted">{t('review.week', { week: weekId.split('-W')[1] })}</p>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => navigate('/app')}>
        <Icon icon={ArrowLeft} size={18} /> {t('review.back')}
      </button>
    </div>
  )

  if (!mandala || !review) {
    return (
      <div className="review-root">
        {header}
        <div className="card review-section">
          <p>{t('review.noMandala')}</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--space-3)' }} onClick={() => navigate('/app/mandala')}>
            {t('review.toMandala')}
          </button>
        </div>
      </div>
    )
  }

  const confirmed = !!saved.data?.confirmed
  const prefix = `${mandala.id}:`
  const laggingTexts = review.lagging
    .filter((id) => id.startsWith(prefix))
    .map((id) => mandala.directions[Number(id.slice(prefix.length))]?.text)
    .filter(Boolean)
  const perDay = review.ease ? WEEK_PLAN.perDayEase : WEEK_PLAN.perDay
  const shownDays = confirmed
    ? (saved.data.plan || []).map((day) => ({ date: day.date, items: (day.titles || []).map((title, i) => ({ key: `${i}-${title}`, title })) }))
    : plan.map((day) => ({ ...day, items: day.items.map((x) => ({ ...x, key: `${x.d}-${x.a}` })) }))
  const hasPlan = plan.some((day) => day.items.length > 0)

  const confirm = async () => {
    setSaving(true)
    try {
      const ops = planTaskOps(plan, mandala, tasks.items)
      for (const u of ops.updates) await tasks.update(u.id, u.patch)
      for (const c of ops.creates) await tasks.add(c) // sequential: keeps order and stays within write limits
      const summaryText = t(review.summary.key, review.summary.vars)
      await saved.save({ ...buildReviewDoc({ weekId, mandala, review, summaryText, plan }), confirmedAt: serverTimestamp() })
      toast.success(t('review.saved', { n: ops.updates.length + ops.creates.length }))
      const reminderDate = nextSundayKey(today)
      if (!hasReviewReminder(reminders.items, reminderDate, REMINDER_TITLES)) {
        await reminders.add({ title: t('today.reminderTitle'), date: reminderDate, time: WEEK_PLAN.reminderTime, done: false })
        toast.success(t('review.reminderAdded'))
      }
    } catch {
      toast.error(t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div className="review-root" initial={{ opacity: 0, y: reduce ? 0 : 10 }} animate={{ opacity: 1, y: 0 }}>
      {header}
      <p className="review-summary">{t(review.summary.key, review.summary.vars)}</p>
      <DirectionBars stats={directionStats(mandala)} t={t} reduce={reduce} />
      <ListSection title={t('review.wins')} icon={Trophy} className="review-win"
        items={review.wins.map((w) => t(w.key, w.vars))} empty={t('review.noWins')} />
      <ListSection title={t('review.lagging')} icon={TriangleAlert} className="review-lag"
        items={laggingTexts} empty={t('review.noLagging')} />
      <section className="card review-section review-advice">
        <h3><Icon icon={Lightbulb} size={18} /> {t('review.advice')}</h3>
        <p>{t(review.advice.key, review.advice.vars)}</p>
      </section>
      <section className="card review-section">
        <h3><Icon icon={CalendarDays} size={18} /> {t('review.plan')}</h3>
        {!confirmed && (
          <p className="text-muted" style={{ marginBottom: 'var(--space-3)' }}>
            {t(review.ease ? 'review.perDayEase' : 'review.perDay', { n: perDay })}
          </p>
        )}
        {!confirmed && !hasPlan ? <p className="text-muted">{t('review.planEmpty')}</p> : <PlanDays days={shownDays} lang={lang} t={t} />}
        <div className="review-actions">
          {confirmed ? (
            <div>
              <div className="review-confirmed"><Icon icon={CircleCheck} size={18} /> {t('review.confirmed')}</div>
              <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('review.confirmedText')}</p>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" disabled={saving || !hasPlan} onClick={confirm}>
              {saving ? t('review.confirming') : t('review.confirm')}
            </button>
          )}
        </div>
      </section>
    </motion.div>
  )
}
