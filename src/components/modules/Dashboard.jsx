import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { formatMoney, toDate, toDateKey } from '../../utils/format'
import { SkeletonCard } from '../ui/Skeleton'

const MOOD_EMOJI = ['😔', '😕', '😐', '🙂', '😄']
const MOOD_COLORS = ['#ef4444','#f97316','#fbbf24','#84cc16','#22c55e']

function greetingKey() {
  const h = new Date().getHours()
  if (h < 12) return 'dash.greetingMorning'
  if (h < 18) return 'dash.greetingAfternoon'
  return 'dash.greetingEvening'
}

function calcStreak(tasks) {
  const doneDays = new Set(
    tasks
      .filter(t => t.status === 'done' && toDate(t.updatedAt))
      .map(t => toDateKey(toDate(t.updatedAt)))
  )
  let streak = 0
  const d = new Date()
  while (doneDays.has(toDateKey(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

const card = (i) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.06, type: 'spring', stiffness: 300, damping: 25 },
})

function StatCard({ icon, label, value, sub, color, to, i }) {
  const navigate = useNavigate()
  return (
    <motion.div
      className="dash-stat-card card"
      {...card(i)}
      onClick={() => to && navigate(to)}
      style={{ cursor: to ? 'pointer' : 'default' }}
      whileHover={to ? { y: -4 } : {}}
    >
      <div className="dash-stat-icon" style={{ background: (color || 'var(--primary)') + '22', color: color || 'var(--primary)' }}>
        {icon}
      </div>
      <div>
        <div className="dash-stat-value">{value}</div>
        <div className="dash-stat-label">{label}</div>
        {sub && <div className="dash-stat-sub">{sub}</div>}
      </div>
    </motion.div>
  )
}

export default function Dashboard() {
  const { profile, user } = useAuth()
  const { t, quote } = useLang()
  const navigate = useNavigate()

  const tasks = useCollection('tasks')
  const habits = useCollection('habits', { orderField: 'createdAt', direction: 'asc' })
  const moods = useCollection('moods', { orderField: 'date' })
  const goals = useCollection('goals')
  const txns = useCollection('transactions', { orderField: 'date' })

  const todayKey = toDateKey()

  const todayTasks = useMemo(
    () => tasks.items.filter(tk => {
      const dl = toDate(tk.deadline)
      return tk.status !== 'done' && (!dl || toDateKey(dl) === todayKey)
    }),
    [tasks.items, todayKey],
  )

  const completedToday = useMemo(
    () => tasks.items.filter(tk =>
      tk.status === 'done' &&
      toDate(tk.updatedAt) &&
      toDateKey(toDate(tk.updatedAt)) === todayKey
    ).length,
    [tasks.items, todayKey],
  )

  const todayMood = useMemo(
    () => moods.items.find(m => m.date === todayKey),
    [moods.items, todayKey],
  )

  const streak = useMemo(() => calcStreak(tasks.items), [tasks.items])

  const habitsToday = useMemo(() => ({
    done: habits.items.filter(h => (h.completions || []).includes(todayKey)).length,
    total: habits.items.length,
  }), [habits.items, todayKey])

  const activeGoals = useMemo(
    () => goals.items.filter(g => !g.completed).length,
    [goals.items],
  )

  const balance = useMemo(
    () => txns.items.reduce((acc, x) => acc + (x.type === 'income' ? x.amount : -x.amount), 0),
    [txns.items],
  )

  const name = profile?.displayName || user?.displayName || ''
  const loading = tasks.loading

  if (loading) {
    return (
      <div className="grid grid-3">
        {[0, 1, 2, 3, 4, 5].map(i => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <div className="dash-root">
      {/* Greeting + streak hero */}
      <motion.div
        className="dash-hero-card card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="dash-hero-left">
          <p className="dash-greeting-sub">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h2 className="dash-greeting">
            {t(greetingKey())}{name ? `, ${name}` : ''} 👋
          </h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {completedToday > 0
              ? `✅ ${completedToday} ${t('dash.completedToday')}`
              : t('dash.noTasksToday')}
          </p>
        </div>
        {streak > 0 && (
          <div className="dash-streak-badge">
            <span style={{ fontSize: 32 }}>🔥</span>
            <div>
              <div className="dash-streak-num">{streak}</div>
              <div className="dash-streak-label" style={{ fontSize: 'var(--text-xs)', opacity: 0.8 }}>{t('prog.streak')}</div>
            </div>
          </div>
        )}
      </motion.div>

      {/* Stat cards row */}
      <div className="dash-stats-grid">
        <StatCard
          i={0}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2"/></svg>}
          label={t('dash.tasksToday')}
          value={todayTasks.length}
          sub={completedToday > 0 ? `+${completedToday} ${t('dash.completedToday')}` : null}
          color="#7c5cff"
          to="/app/tasks"
        />
        <StatCard
          i={1}
          icon={<span style={{ fontSize: 20 }}>🔥</span>}
          label={t('habits.title')}
          value={`${habitsToday.done}/${habitsToday.total}`}
          sub={t('habits.doneToday')}
          color="#f97316"
          to="/app/habits"
        />
        <StatCard
          i={2}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>}
          label={t('nav.goals')}
          value={activeGoals}
          sub={t('dash.activeGoals') || 'active'}
          color="#10b981"
          to="/app/goals"
        />
        <StatCard
          i={3}
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l5-5 4 4 8-8M16 8h4v4"/></svg>}
          label={t('dash.balance')}
          value={formatMoney(balance, txns.items[0]?.currency || 'KGS')}
          color={balance >= 0 ? '#22c55e' : '#ef4444'}
          to="/app/finance"
        />
      </div>

      {/* Quick actions */}
      <div className="section-title" style={{ marginBottom: 'var(--space-3)' }}>{t('dash.quickActions')}</div>
      <div className="quick-actions" style={{ marginBottom: 'var(--space-6)' }}>
        {[
          { label: t('dash.newTask'), to: '/app/tasks', icon: 'M12 5v14M5 12h14', color: '#7c5cff' },
          { label: t('habits.newTitle'), to: '/app/habits', icon: 'M12 2l1.5 4.5H18l-3.75 2.75 1.5 4.5L12 11l-3.75 2.75 1.5-4.5L6 6.5h4.5Z', color: '#f97316' },
          { label: t('dash.logMood'), to: '/app/mood', icon: 'M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01', color: '#ec4899' },
          { label: t('dash.addTxn'), to: '/app/finance', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', color: '#10b981' },
        ].map((qa, i) => (
          <motion.button
            key={qa.label}
            className="quick-action"
            onClick={() => navigate(qa.to)}
            {...card(i)}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.97 }}
          >
            <span className="qa-icon" style={{ background: qa.color + '22', color: qa.color }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={qa.icon} />
              </svg>
            </span>
            {qa.label}
          </motion.button>
        ))}
      </div>

      {/* Today tasks + mood */}
      <div className="dash-bottom-grid">
        {/* Today's tasks */}
        <motion.div className="card" {...card(4)}>
          <div className="widget-head" style={{ marginBottom: 'var(--space-3)' }}>
            <h3>{t('dash.tasksToday')}</h3>
            <button className="btn btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '4px 8px', minHeight: 'unset' }} onClick={() => navigate('/app/tasks')}>
              {t('common.all')} →
            </button>
          </div>
          {todayTasks.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 'var(--text-sm)', textAlign: 'center', padding: 'var(--space-5) 0' }}>
              🎉 {t('dash.allDone') || 'All done for today!'}
            </p>
          ) : (
            <div className="list-stack">
              {todayTasks.slice(0, 5).map(tk => (
                <div key={tk.id} className="dash-task-row">
                  <div className="dash-task-dot" style={{ background: tk.priority === 'high' ? '#ef4444' : tk.priority === 'medium' ? '#f59e0b' : 'var(--primary)' }} />
                  <span className="dash-task-name">{tk.title}</span>
                  {tk.deadline && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {new Date(toDate(tk.deadline)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              ))}
              {todayTasks.length > 5 && (
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)', textAlign: 'center' }}>
                  +{todayTasks.length - 5} {t('common.more') || 'more'}
                </p>
              )}
            </div>
          )}
        </motion.div>

        {/* Mood + quote */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <motion.div
            className="card dash-mood-card"
            {...card(5)}
            onClick={() => navigate('/app/mood')}
            style={{ cursor: 'pointer' }}
            whileHover={{ y: -2 }}
          >
            <div className="widget-head">
              <h3>{t('dash.mood')}</h3>
              {todayMood && <span style={{ fontSize: 'var(--text-sm)', color: MOOD_COLORS[todayMood.value] }}>●</span>}
            </div>
            {todayMood ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 4 }}>
                <span style={{ fontSize: 42 }}>{MOOD_EMOJI[todayMood.value]}</span>
                <div>
                  <div style={{ fontWeight: 700, color: MOOD_COLORS[todayMood.value] }}>
                    {['😔','😕','😐','🙂','😄'][todayMood.value]}
                  </div>
                  <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{t('common.today')}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 4 }}>
                <span style={{ fontSize: 36 }}>🤔</span>
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('mood.howAreYou')}</p>
              </div>
            )}
          </motion.div>

          <motion.div className="card dquote" {...card(6)}>
            <div className="dquote-text">"{quote()}"</div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
