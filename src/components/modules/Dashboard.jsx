import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { formatMoney, toDate, toDateKey } from '../../utils/format'
import { SkeletonCard } from '../ui/Skeleton'
import { ChevronRight, DollarSign, Flame, ListChecks, PartyPopper, Plus, SmilePlus, Target, TrendingUp } from 'lucide-react'
import Icon from '../ui/Icon'
import { MODULE_ICONS } from '../../config/moduleIcons'
import TodayCard from './dashboard/TodayCard'
import DashHero from './dashboard/DashHero'
import StatCard from './dashboard/StatCard'
import { calcStreak, greetingName } from './dashboard/dashboardModel'
import { todayFromSearch } from '../../ai/engine/weekPlan'
import './dashboard/dashboard.css'

const MOOD_EMOJI = ['😔', '😕', '😐', '🙂', '😄']
const MOOD_COLORS = ['#ef4444','#f97316','#fbbf24','#84cc16','#22c55e']
const PRIORITY_COLORS = { high: '#ef4444', medium: '#f59e0b' }
const MAX_TASK_ROWS = 5

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
// rise and swaps the spring for a short linear fade. Hover effects live in CSS
// under @media (hover: hover) so touch screens never get a stuck "lifted" card.
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

export default function Dashboard() {
  const { profile, user } = useAuth()
  const { t, tp, lang, quote } = useLang()
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

  const name = greetingName(profile, user)
  const loading = tasks.loading
  // Plural forms come from tp() once LangContext provides it; until then the plain key.
  const activeGoalsLabel = typeof tp === 'function' ? tp('dash.activeGoals', activeGoals) : t('dash.activeGoals')

  const reduce = useReducedMotion()
  const root = useMemo(() => groupVariants(reduce, 0.1), [reduce])
  const group = useMemo(() => groupVariants(reduce, 0.06), [reduce])
  const item = useMemo(() => cardVariants(reduce), [reduce])

  if (loading) {
    return (
      <div className="dash-stats-grid">
        {[0, 1, 2, 3, 4, 5].map(i => <SkeletonCard key={i} />)}
      </div>
    )
  }

  const quickActions = [
    { label: t('dash.newTask'), to: '/app/tasks', icon: Plus, color: '#7c5cff' },
    { label: t('habits.newTitle'), to: '/app/habits', icon: MODULE_ICONS.habits, color: '#f97316' },
    { label: t('dash.logMood'), to: '/app/mood', icon: MODULE_ICONS.mood, color: '#ec4899' },
    { label: t('dash.addTxn'), to: '/app/finance', icon: DollarSign, color: '#10b981' },
  ]

  return (
    <motion.div className="dash-root" variants={root} initial="hidden" animate="show">
      <DashHero name={name} completedToday={completedToday} streak={streak} variants={item} />

      {/* My day: weekly review banner, 3 tasks for today, morning checklist */}
      <motion.div variants={item}>
        <TodayCard today={today} />
      </motion.div>

      {/* Stat cards: 2 columns on phones, 4 from tablets/laptops */}
      <motion.div className="dash-stats-grid" variants={group}>
        <StatCard
          variants={item}
          icon={<Icon icon={ListChecks} />}
          label={t('dash.tasksToday')}
          value={todayTasks.length}
          sub={completedToday > 0 ? `+${completedToday} ${t('dash.completedToday')}` : null}
          color="#7c5cff"
          to="/app/tasks"
        />
        <StatCard
          variants={item}
          icon={<Icon icon={Flame} />}
          label={t('habits.title')}
          value={`${habitsToday.done}/${habitsToday.total}`}
          sub={t('habits.doneToday')}
          color="#f97316"
          to="/app/habits"
        />
        <StatCard
          variants={item}
          icon={<Icon icon={Target} />}
          label={t('nav.goals')}
          value={activeGoals}
          sub={activeGoalsLabel}
          color="#10b981"
          to="/app/goals"
        />
        <StatCard
          variants={item}
          icon={<Icon icon={TrendingUp} />}
          label={t('dash.balance')}
          value={formatMoney(balance, txns.items[0]?.currency || 'KGS', lang)}
          color={balance >= 0 ? '#22c55e' : '#ef4444'}
          to="/app/finance"
        />
      </motion.div>

      {/* Quick actions */}
      <section className="dash-section" aria-labelledby="dash-qa-title">
        <h3 id="dash-qa-title" className="dash-section-title">{t('dash.quickActions')}</h3>
        <motion.div className="dash-qa-grid" variants={group}>
          {quickActions.map((qa) => (
            <motion.div key={qa.to + qa.label} variants={item}>
              <Link to={qa.to} className="dash-qa" style={{ '--qa-color': qa.color }}>
                <span className="dash-qa-icon" aria-hidden="true">
                  <Icon icon={qa.icon} size={22} />
                </span>
                <span className="dash-qa-label">{qa.label}</span>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Today tasks + mood */}
      <motion.div className="dash-bottom-grid" variants={group}>
        {/* Today's tasks */}
        <motion.div className="card dash-tasks-card" variants={item}>
          <div className="dash-widget-head">
            <h3>{t('dash.tasksToday')}</h3>
            <Link to="/app/tasks" className="dash-more-link">
              {t('common.all')} <Icon icon={ChevronRight} size={16} />
            </Link>
          </div>
          {todayTasks.length === 0 ? (
            <p className="dash-empty">
              <Icon icon={PartyPopper} size="1em" className="dash-inline-icon" /> {t('dash.allDone') || 'All done for today!'}
            </p>
          ) : (
            <ul className="dash-task-list">
              {todayTasks.slice(0, MAX_TASK_ROWS).map(tk => (
                <li key={tk.id} className="dash-task-row">
                  <span className="dash-task-dot" style={{ background: PRIORITY_COLORS[tk.priority] || 'var(--primary)' }} />
                  <span className="dash-task-name">{tk.title}</span>
                  {tk.deadline && (
                    <span className="dash-task-date">
                      {toDate(tk.deadline).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </li>
              ))}
              {todayTasks.length > MAX_TASK_ROWS && (
                <li className="dash-task-more">
                  +{todayTasks.length - MAX_TASK_ROWS} {t('common.more') || 'more'}
                </li>
              )}
            </ul>
          )}
        </motion.div>

        {/* Mood + quote */}
        <motion.div className="dash-side-col" variants={group}>
          <motion.div variants={item}>
            <Link to="/app/mood" className="card dash-mood-card">
              <div className="dash-widget-head">
                <h3>{t('dash.mood')}</h3>
                {todayMood && <span aria-hidden="true" style={{ color: MOOD_COLORS[todayMood.value] }}>●</span>}
              </div>
              {todayMood ? (
                <div className="dash-mood-body">
                  <span className="dash-mood-emoji">{MOOD_EMOJI[todayMood.value]}</span>
                  <span className="dash-mood-when">{t('common.today')}</span>
                </div>
              ) : (
                <div className="dash-mood-body">
                  <Icon icon={SmilePlus} size={36} className="dash-mood-empty-icon" />
                  <span className="dash-mood-when">{t('mood.howAreYou')}</span>
                </div>
              )}
            </Link>
          </motion.div>

          <motion.figure className="card dash-quote" variants={item}>
            <blockquote className="dash-quote-text">“{quote()}”</blockquote>
          </motion.figure>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
