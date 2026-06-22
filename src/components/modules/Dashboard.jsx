import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { formatMoney, toDate, toDateKey } from '../../utils/format'
import { SkeletonCard } from '../ui/Skeleton'

const MOOD_EMOJI = ['😔', '😕', '😐', '🙂', '😄']

function greetingKey() {
  const h = new Date().getHours()
  if (h < 12) return 'dash.greetingMorning'
  if (h < 18) return 'dash.greetingAfternoon'
  return 'dash.greetingEvening'
}

const card = (i) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.06, type: 'spring', stiffness: 300, damping: 25 },
})

export default function Dashboard() {
  const { profile, user } = useAuth()
  const { t, quote } = useLang()
  const navigate = useNavigate()

  const tasks = useCollection('tasks')
  const moods = useCollection('moods', { orderField: 'date' })
  const events = useCollection('events', { orderField: 'date' })
  const txns = useCollection('transactions', { orderField: 'date' })
  const notes = useCollection('notes')

  const todayKey = toDateKey()

  const todayTasks = useMemo(
    () =>
      tasks.items.filter((tk) => {
        const dl = toDate(tk.deadline)
        return tk.status !== 'done' && (!dl || toDateKey(dl) === todayKey)
      }),
    [tasks.items, todayKey],
  )

  const todayMood = useMemo(
    () => moods.items.find((m) => m.date === todayKey),
    [moods.items, todayKey],
  )

  const upcomingEvents = useMemo(
    () =>
      events.items
        .filter((e) => toDate(e.date) && toDate(e.date) >= new Date(todayKey))
        .slice(0, 3),
    [events.items, todayKey],
  )

  const balance = useMemo(
    () =>
      txns.items.reduce((acc, x) => acc + (x.type === 'income' ? x.amount : -x.amount), 0),
    [txns.items],
  )

  const completedToday = tasks.items.filter(
    (tk) => tk.status === 'done' && toDate(tk.updatedAt) && toDateKey(toDate(tk.updatedAt)) === todayKey,
  ).length

  const name = profile?.displayName || user?.displayName || ''
  const loading = tasks.loading

  if (loading) {
    return (
      <div className="grid grid-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="dash-hero">
        <h1>
          {t(greetingKey())}
          {name ? `, ${name}` : ''} 👋
        </h1>
        <p>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      <div className="section-title">{t('dash.quickActions')}</div>
      <div className="quick-actions" style={{ marginBottom: 'var(--space-6)' }}>
        {[
          { label: t('dash.newTask'), to: '/app/tasks?new=1', icon: 'M12 5v14M5 12h14' },
          { label: t('dash.newNote'), to: '/app/notes?new=1', icon: 'M12 20h9M4 4h7l4 4v12H4Z' },
          { label: t('dash.logMood'), to: '/app/mood', icon: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01' },
          { label: t('dash.addTxn'), to: '/app/finance?new=1', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
        ].map((qa, i) => (
          <motion.button key={qa.label} className="quick-action" onClick={() => navigate(qa.to)} {...card(i)} whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }}>
            <span className="qa-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={qa.icon} />
              </svg>
            </span>
            {qa.label}
          </motion.button>
        ))}
      </div>

      <div className="grid grid-3">
        <motion.div className="card widget" {...card(0)} onClick={() => navigate('/app/tasks')} style={{ cursor: 'pointer' }}>
          <div className="widget-head">
            <h3>{t('dash.tasksToday')}</h3>
            <span className="widget-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2" /></svg>
            </span>
          </div>
          <div className="widget-value">{todayTasks.length}</div>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{completedToday} {t('dash.completedToday')}</p>
          {todayTasks.slice(0, 3).map((tk) => (
            <div key={tk.id} className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>• {tk.title}</div>
          ))}
          {todayTasks.length === 0 && <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('dash.noTasksToday')}</p>}
        </motion.div>

        <motion.div className="card widget" {...card(1)} onClick={() => navigate('/app/mood')} style={{ cursor: 'pointer' }}>
          <div className="widget-head">
            <h3>{t('dash.mood')}</h3>
            <span className="widget-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /></svg></span>
          </div>
          <div style={{ fontSize: 48 }}>{todayMood ? MOOD_EMOJI[todayMood.value] : '—'}</div>
          {!todayMood && <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('mood.howAreYou')}</p>}
        </motion.div>

        <motion.div className="card widget" {...card(2)} onClick={() => navigate('/app/calendar')} style={{ cursor: 'pointer' }}>
          <div className="widget-head">
            <h3>{t('dash.events')}</h3>
            <span className="widget-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /></svg></span>
          </div>
          {upcomingEvents.length ? (
            upcomingEvents.map((e) => (
              <div key={e.id} className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
                <span style={{ color: e.color || 'var(--primary)' }}>●</span> {e.title}
              </div>
            ))
          ) : (
            <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('cal.noEvents')}</p>
          )}
        </motion.div>

        <motion.div className="card widget" {...card(3)} onClick={() => navigate('/app/finance')} style={{ cursor: 'pointer' }}>
          <div className="widget-head">
            <h3>{t('dash.balance')}</h3>
            <span className="widget-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-5 4 4 8-8M16 8h4v4" /></svg></span>
          </div>
          <div className="widget-value" style={{ color: balance >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(balance, txns.items[0]?.currency || 'KGS')}</div>
        </motion.div>

        <motion.div className="card widget" {...card(4)} onClick={() => navigate('/app/notes')} style={{ cursor: 'pointer' }}>
          <div className="widget-head">
            <h3>{t('dash.notes')}</h3>
            <span className="widget-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h12l4 4v12H4Z" /></svg></span>
          </div>
          <div className="widget-value">{notes.items.length}</div>
          {notes.items.slice(0, 2).map((n) => (
            <div key={n.id} className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>• {n.title || t('common.untitled')}</div>
          ))}
        </motion.div>

        <motion.div className="card widget dquote" {...card(5)}>
          <div className="widget-head">
            <h3 style={{ color: '#fff' }}>{t('dash.quote')}</h3>
          </div>
          <p className="dquote-text">“{quote()}”</p>
        </motion.div>
      </div>
    </div>
  )
}
