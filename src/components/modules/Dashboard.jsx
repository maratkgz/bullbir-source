import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { formatMoney, toDate, toDateKey } from '../../utils/format'
import { SkeletonCard } from '../ui/Skeleton'
import { CircleCheck, DollarSign, Flame, Hand, ListChecks, PartyPopper, Plus, SmilePlus, Target, TrendingUp } from 'lucide-react'
import Icon from '../ui/Icon'
import { MODULE_ICONS } from '../../config/moduleIcons'
import TodayCard from './dashboard/TodayCard'
import { todayFromSearch } from '../../ai/engine/weekPlan'

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

// Stagger group: fans its motion children out in sequence. When `reduce` is set
// (prefers-reduced-motion) the stagger collapses to 0 so everything fades together.
function groupVariants(reduce, stagger = 0.08, delayChildren = 0) {
  return {
    hidden: {},
    show: {
      transition: reduce
        ? { staggerChildren: 0, delayChildren: 0 }
        : { staggerChildren: stagger, delayChildren },
    },
  }
}

// Single card entrance: fade + rise on a soft spring. Reduced-motion drops the
// rise and swaps the spring for a short linear fade.
function cardVariants(reduce) {
  return {
    hidden: { opacity: 0, y: reduce ? 0 : 18 },
    show: {
      opacity: 1,
      y: 0,
      transition: reduce
        ? { duration: 0.15 }
        : { type: 'spring', stiffness: 300, damping: 26 },
    },
  }
}

// Soft hover lift — disabled entirely under reduced motion.
function hoverLift(reduce, y = -4) {
  return reduce ? undefined : { y, transition: { type: 'spring', stiffness: 400, damping: 22 } }
}

function StatCard({ icon, label, value, sub, color, to, variants, reduce }) {
  const navigate = useNavigate()
  return (
    <motion.div
      className="dash-stat-card card"
      variants={variants}
      onClick={() => to && navigate(to)}
      style={{ cursor: to ? 'pointer' : 'default' }}
      whileHover={to ? hoverLift(reduce) : undefined}
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
  const location = useLocation()
  // Dev-only ?today=YYYY-MM-DD override to try the Sunday review flow.
  const today = useMemo(() => todayFromSearch(location.search, import.meta.env.DEV), [location.search])

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

  const reduce = useReducedMotion()
  const root = useMemo(() => groupVariants(reduce, 0.1), [reduce])
  const group = useMemo(() => groupVariants(reduce, 0.06), [reduce])
  const item = useMemo(() => cardVariants(reduce), [reduce])

  if (loading) {
    return (
      <div className="grid grid-3">
        {[0, 1, 2, 3, 4, 5].map(i => <SkeletonCard key={i} />)}
      </div>
    )
  }

  return (
    <motion.div className="dash-root" variants={root} initial="hidden" animate="show">
      {/* Greeting + streak hero */}
      <motion.div className="dash-hero-card card" variants={item}>
        <div className="dash-hero-left">
          <p className="dash-greeting-sub">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h2 className="dash-greeting">
            {t(greetingKey())}{name ? `, ${name}` : ''} <Icon icon={Hand} size="1em" />
          </h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {completedToday > 0
              ? <><Icon icon={CircleCheck} size="1em" /> {completedToday} {t('dash.completedToday')}</>
              : t('dash.noTasksToday')}
          </p>
        </div>
        {streak > 0 && (
          <div className="dash-streak-badge">
            <span style={{ fontSize: 32 }}><Icon icon={Flame} size="1em" /></span>
            <div>
              <div className="dash-streak-num">{streak}</div>
              <div className="dash-streak-label" style={{ fontSize: 'var(--text-xs)', opacity: 0.8 }}>{t('prog.streak')}</div>
            </div>
          </div>
        )}
      </motion.div>

      {/* My day: weekly review banner, 3 tasks for today, morning checklist */}
      <motion.div variants={item}>
        <TodayCard today={today} />
      </motion.div>

      {/* Stat cards row */}
      <motion.div className="dash-stats-grid" variants={group}>
        <StatCard
          variants={item}
          reduce={reduce}
          icon={<Icon icon={ListChecks} />}
          label={t('dash.tasksToday')}
          value={todayTasks.length}
          sub={completedToday > 0 ? `+${completedToday} ${t('dash.completedToday')}` : null}
          color="#7c5cff"
          to="/app/tasks"
        />
        <StatCard
          variants={item}
          reduce={reduce}
          icon={<Icon icon={Flame} />}
          label={t('habits.title')}
          value={`${habitsToday.done}/${habitsToday.total}`}
          sub={t('habits.doneToday')}
          color="#f97316"
          to="/app/habits"
        />
        <StatCard
          variants={item}
          reduce={reduce}
          icon={<Icon icon={Target} />}
          label={t('nav.goals')}
          value={activeGoals}
          sub={t('dash.activeGoals') || 'active'}
          color="#10b981"
          to="/app/goals"
        />
        <StatCard
          variants={item}
          reduce={reduce}
          icon={<Icon icon={TrendingUp} />}
          label={t('dash.balance')}
          value={formatMoney(balance, txns.items[0]?.currency || 'KGS')}
          color={balance >= 0 ? '#22c55e' : '#ef4444'}
          to="/app/finance"
        />
      </motion.div>

      {/* Quick actions */}
      <div className="section-title" style={{ marginBottom: 'var(--space-3)' }}>{t('dash.quickActions')}</div>
      <motion.div className="quick-actions" style={{ marginBottom: 'var(--space-6)' }} variants={group}>
        {[
          { label: t('dash.newTask'), to: '/app/tasks', icon: Plus, color: '#7c5cff' },
          { label: t('habits.newTitle'), to: '/app/habits', icon: MODULE_ICONS.habits, color: '#f97316' },
          { label: t('dash.logMood'), to: '/app/mood', icon: MODULE_ICONS.mood, color: '#ec4899' },
          { label: t('dash.addTxn'), to: '/app/finance', icon: DollarSign, color: '#10b981' },
        ].map((qa) => (
          <motion.button
            key={qa.label}
            className="quick-action"
            onClick={() => navigate(qa.to)}
            variants={item}
            whileHover={hoverLift(reduce)}
            whileTap={reduce ? undefined : { scale: 0.97 }}
          >
            <span className="qa-icon" style={{ background: qa.color + '22', color: qa.color }}>
              <Icon icon={qa.icon} size={22} />
            </span>
            {qa.label}
          </motion.button>
        ))}
      </motion.div>

      {/* Today tasks + mood */}
      <motion.div className="dash-bottom-grid" variants={group}>
        {/* Today's tasks */}
        <motion.div className="card" variants={item}>
          <div className="widget-head" style={{ marginBottom: 'var(--space-3)' }}>
            <h3>{t('dash.tasksToday')}</h3>
            <button className="btn btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '4px 8px', minHeight: 'unset' }} onClick={() => navigate('/app/tasks')}>
              {t('common.all')} →
            </button>
          </div>
          {todayTasks.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 'var(--text-sm)', textAlign: 'center', padding: 'var(--space-5) 0' }}>
              <Icon icon={PartyPopper} size="1em" /> {t('dash.allDone') || 'All done for today!'}
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
        <motion.div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} variants={group}>
          <motion.div
            className="card dash-mood-card"
            variants={item}
            onClick={() => navigate('/app/mood')}
            style={{ cursor: 'pointer' }}
            whileHover={hoverLift(reduce, -2)}
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
                <span style={{ fontSize: 36 }}><Icon icon={SmilePlus} size="1em" /></span>
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('mood.howAreYou')}</p>
              </div>
            )}
          </motion.div>

          <motion.div className="card dquote" variants={item}>
            <div className="dquote-text">"{quote()}"</div>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
