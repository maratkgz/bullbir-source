import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'
import { format, subDays, eachDayOfInterval, startOfWeek, subWeeks } from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useLang } from '../../context/LangContext'
import { toDateKey, formatMoney } from '../../utils/format'

// XP rewards per activity type
const XP_TASK = 5
const XP_JOURNAL = 10
const XP_MOOD = 5
const XP_SHIFT = 15
const XP_SAVINGS_GOAL = 50
const XP_HABIT_DAY = 3

function levelFromXP(xp) {
  return Math.max(1, Math.floor(Math.sqrt(xp / 50)) + 1)
}

function xpForLevel(lv) {
  return lv <= 1 ? 0 : (lv - 1) * (lv - 1) * 50
}

const BADGES = [
  { id: 'first_task',    icon: '✅', name: 'First Step',      desc: 'Complete 1 task',          check: (d) => d.tasksDone >= 1 },
  { id: 'tasks_10',      icon: '🔥', name: 'On Fire',         desc: 'Complete 10 tasks',         check: (d) => d.tasksDone >= 10 },
  { id: 'tasks_100',     icon: '💯', name: 'Century',         desc: 'Complete 100 tasks',        check: (d) => d.tasksDone >= 100 },
  { id: 'first_mood',    icon: '😊', name: 'Feeling Good',    desc: 'Log your first mood',       check: (d) => d.moodDays >= 1 },
  { id: 'mood_7',        icon: '🌈', name: 'Mood Streak',     desc: '7 mood check-ins',          check: (d) => d.moodDays >= 7 },
  { id: 'mood_30',       icon: '🌟', name: 'Mindful Month',   desc: '30 mood check-ins',         check: (d) => d.moodDays >= 30 },
  { id: 'first_journal', icon: '📝', name: 'First Entry',     desc: 'Write your first journal',  check: (d) => d.journalDays >= 1 },
  { id: 'journal_7',     icon: '📖', name: 'Storyteller',     desc: '7 journal entries',         check: (d) => d.journalDays >= 7 },
  { id: 'journal_30',    icon: '📚', name: 'Diarist',         desc: '30 journal entries',        check: (d) => d.journalDays >= 30 },
  { id: 'first_shift',   icon: '💼', name: 'Work Hard',       desc: 'Complete a shift',          check: (d) => d.shiftsWorked >= 1 },
  { id: 'shifts_10',     icon: '🏢', name: 'Professional',    desc: 'Complete 10 shifts',        check: (d) => d.shiftsWorked >= 10 },
  { id: 'savings_goal',  icon: '💰', name: 'Goal Getter',     desc: 'Reach a savings goal',      check: (d) => d.savingsCompleted >= 1 },
  { id: 'level_5',       icon: '⭐', name: 'Rising Star',     desc: 'Reach Level 5',             check: (d) => d.level >= 5 },
  { id: 'level_10',      icon: '🏆', name: 'Champion',        desc: 'Reach Level 10',            check: (d) => d.level >= 10 },
  { id: 'all_around',    icon: '🌍', name: 'All Rounder',     desc: 'Use 5 different modules',   check: (d) => d.modulesUsed >= 5 },
]

const PIE_COLORS = ['#5b4fcf', '#ff6b35', '#22c55e', '#f59e0b', '#7c6ff7', '#ef4444']

export default function PersonalProgress() {
  const { t } = useLang()
  const [currency] = useLocalStorage('bullbir_currency', 'KGS')
  const [tab, setTab] = useState('overview') // 'overview' | 'analytics'
  const [period, setPeriod] = useState('month') // 'week'|'month'|'year'|'all'
  const [prevLevel, setPrevLevel] = useLocalStorage('bullbir_prev_level', 1)
  const [showLevelUp, setShowLevelUp] = useState(false)

  const { items: tasks } = useCollection('tasks', { orderField: 'createdAt', direction: 'desc' })
  const { items: moods } = useCollection('moods', { orderField: 'date', direction: 'desc' })
  const { items: journals } = useCollection('journalEntries', { orderField: 'date', direction: 'desc' })
  const { items: shifts } = useCollection('shifts', { orderField: 'date', direction: 'desc' })
  const { items: savingsGoals } = useCollection('savingsGoals', { orderField: 'createdAt', direction: 'desc' })
  const { items: habits } = useCollection('habits', { orderField: 'createdAt', direction: 'desc' })
  const { items: transactions } = useCollection('transactions', { orderField: 'date', direction: 'desc' })

  // Compute period start date
  const periodStart = useMemo(() => {
    const now = new Date()
    if (period === 'week') return subDays(now, 7)
    if (period === 'month') return subDays(now, 30)
    if (period === 'year') return subDays(now, 365)
    return new Date('2000-01-01')
  }, [period])

  function inPeriod(dateVal) {
    if (!dateVal) return false
    const d = typeof dateVal === 'string' ? new Date(dateVal) : (dateVal?.toDate?.() || new Date(dateVal))
    return d >= periodStart
  }

  // Core stats (all-time for XP, period-filtered for display)
  const allStats = useMemo(() => {
    const tasksDone = tasks.filter((t) => t.status === 'done').length
    const moodDays = moods.length
    const journalDays = journals.length
    const shiftsWorked = shifts.filter((s) => s.status === 'completed').length
    const savingsCompleted = savingsGoals.filter((g) => g.completed).length
    const habitDays = habits.reduce((a, h) => a + Object.keys(h.log || {}).length, 0)

    const totalXP =
      tasksDone * XP_TASK +
      moodDays * XP_MOOD +
      journalDays * XP_JOURNAL +
      shiftsWorked * XP_SHIFT +
      savingsCompleted * XP_SAVINGS_GOAL +
      habitDays * XP_HABIT_DAY

    const level = levelFromXP(totalXP)
    const xpThisLevel = totalXP - xpForLevel(level)
    const xpNeeded = xpForLevel(level + 1) - xpForLevel(level)
    const xpPct = xpNeeded > 0 ? Math.min(100, Math.round((xpThisLevel / xpNeeded) * 100)) : 100

    const modulesUsed = [tasksDone > 0, moodDays > 0, journalDays > 0, shiftsWorked > 0, savingsCompleted > 0].filter(Boolean).length

    return { tasksDone, moodDays, journalDays, shiftsWorked, savingsCompleted, habitDays, totalXP, level, xpThisLevel, xpNeeded, xpPct, modulesUsed }
  }, [tasks, moods, journals, shifts, savingsGoals, habits])

  // Period-filtered stats
  const periodStats = useMemo(() => {
    const tasksDone = tasks.filter((t) => t.status === 'done' && inPeriod(t.updatedAt || t.createdAt)).length
    const moodDays = moods.filter((m) => inPeriod(m.date)).length
    const journalDays = journals.filter((j) => inPeriod(j.date)).length
    const shiftsWorked = shifts.filter((s) => s.status === 'completed' && inPeriod(s.date)).length
    const income = transactions.filter((x) => x.type === 'income' && inPeriod(x.date)).reduce((a, x) => a + x.amount, 0)
    const expense = transactions.filter((x) => x.type === 'expense' && inPeriod(x.date)).reduce((a, x) => a + x.amount, 0)
    const avgMoodVal = moodDays > 0
      ? moods.filter((m) => inPeriod(m.date)).reduce((a, m) => a + (m.value ?? 0), 0) / moodDays
      : null
    const habitsDone = habits.reduce((a, h) => {
      const logs = Object.keys(h.log || {}).filter((k) => inPeriod(k))
      return a + logs.length
    }, 0)
    return { tasksDone, moodDays, journalDays, shiftsWorked, income, expense, avgMoodVal, habitsDone }
  }, [tasks, moods, journals, shifts, transactions, habits, periodStart])

  // Check for level up
  useEffect(() => {
    if (allStats.level > prevLevel) {
      setShowLevelUp(true)
      setPrevLevel(allStats.level)
      const id = setTimeout(() => setShowLevelUp(false), 3000)
      return () => clearTimeout(id)
    }
  }, [allStats.level])

  // Heatmap: last 52 weeks × 7 days
  const heatmapData = useMemo(() => {
    const end = new Date()
    const start = subWeeks(startOfWeek(end, { weekStartsOn: 1 }), 51)
    const days = eachDayOfInterval({ start, end })

    const activityByDate = {}
    tasks.filter((x) => x.status === 'done').forEach((x) => {
      const d = toDateKey(x.updatedAt?.toDate?.() || new Date(x.updatedAt || x.createdAt))
      activityByDate[d] = (activityByDate[d] || 0) + 1
    })
    moods.forEach((x) => { activityByDate[x.date] = (activityByDate[x.date] || 0) + 1 })
    journals.forEach((x) => { activityByDate[x.date] = (activityByDate[x.date] || 0) + 2 })

    const max = Math.max(1, ...Object.values(activityByDate))
    return days.map((d) => {
      const key = toDateKey(d)
      const val = activityByDate[key] || 0
      const level = val === 0 ? 0 : val < max * 0.25 ? 1 : val < max * 0.5 ? 2 : val < max * 0.75 ? 3 : 4
      return { key, level }
    })
  }, [tasks, moods, journals])

  // Mood chart (last 30 days)
  const moodChart = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const d = subDays(new Date(), 29 - i)
      const key = toDateKey(d)
      const m = moods.find((x) => x.date === key)
      return { name: format(d, 'd'), mood: m != null ? (m.value ?? 0) + 1 : null }
    })
  }, [moods])

  // Tasks done per week (last 8 weeks)
  const taskChart = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const weekEnd = subDays(new Date(), i * 7)
      const weekStart = subDays(weekEnd, 6)
      const count = tasks.filter((t) => {
        if (t.status !== 'done') return false
        const d = t.updatedAt?.toDate?.() || new Date(t.updatedAt || t.createdAt)
        return d >= weekStart && d <= weekEnd
      }).length
      return { name: format(weekEnd, 'MMM d'), tasks: count }
    }).reverse()
  }, [tasks])

  // Finance by category
  const financeByCategory = useMemo(() => {
    const map = {}
    transactions.filter((x) => x.type === 'expense' && inPeriod(x.date)).forEach((x) => {
      map[x.category] = (map[x.category] || 0) + x.amount
    })
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [transactions, periodStart])

  // Active streak (consecutive days with any activity)
  const streak = useMemo(() => {
    const active = new Set([
      ...tasks.filter((t) => t.status === 'done').map((t) => toDateKey(t.updatedAt?.toDate?.() || new Date(t.updatedAt || t.createdAt))),
      ...moods.map((m) => m.date),
      ...journals.map((j) => j.date),
    ])
    let count = 0
    let d = new Date()
    while (active.has(toDateKey(d))) {
      count++
      d = subDays(d, 1)
    }
    return count
  }, [tasks, moods, journals])

  // Badges
  const badgeStatus = useMemo(() => {
    const data = { ...allStats, streak }
    return BADGES.map((b) => ({ ...b, unlocked: b.check(data) }))
  }, [allStats, streak])

  const unlockedCount = badgeStatus.filter((b) => b.unlocked).length

  const MOOD_LABELS = ['', '😫', '😕', '😐', '🙂', '😄']

  return (
    <div>
      {/* Level Up overlay */}
      <AnimatePresence>
        {showLevelUp && (
          <motion.div className="prog-levelup-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowLevelUp(false)}>
            <motion.div initial={{ scale: 0.5 }} animate={{ scale: [0.5, 1.1, 1] }} transition={{ duration: 0.5 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
              <div className="prog-levelup-num">{allStats.level}</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginTop: 8 }}>{t('prog.levelUp')}</div>
              <p style={{ opacity: 0.7, marginTop: 8 }}>{t('prog.level')} {allStats.level}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="module-header">
        <div>
          <h2 style={{ letterSpacing: '-0.02em' }}>{t('prog.title')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
            Твой прогресс
          </p>
        </div>
        <div className="tasks-tabs">
          <button className={`tasks-tab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>{t('prog.overview')}</button>
          <button className={`tasks-tab${tab === 'analytics' ? ' active' : ''}`} onClick={() => setTab('analytics')}>{t('prog.analytics')}</button>
        </div>
      </div>

      {/* Level / XP hero card */}
      <div className="prog-hero-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {/* Conic ring */}
          <div style={{
            width: 130, height: 130, borderRadius: '50%', flexShrink: 0,
            background: `conic-gradient(#fff ${allStats.xpPct}%, rgba(255,255,255,0.22) 0)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 102, height: 102, borderRadius: '50%', background: '#5b3fe0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: '#fff', lineHeight: 1, letterSpacing: '-0.04em' }}>
                {allStats.xpPct}%
              </span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600, marginTop: 3 }}>
                выполнено
              </span>
            </div>
          </div>
          {/* Stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 }}>
                {streak} <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>дней</span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 500, marginTop: 2 }}>текущий стрик 🔥</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 }}>
                {allStats.totalXP}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 500, marginTop: 2 }}>всего XP · Уровень {allStats.level}</div>
            </div>
          </div>
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(255,255,255,0.16)', padding: '7px 13px', borderRadius: 99, marginTop: 18,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ffb59c', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
            {allStats.xpNeeded - allStats.xpThisLevel} XP до уровня {allStats.level + 1}
          </span>
        </div>
      </div>

      {/* Period selector */}
      <div className="analytics-period">
        {['week', 'month', 'year', 'all'].map((p) => (
          <button key={p} className={`btn ${period === p ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '6px 16px' }}
            onClick={() => setPeriod(p)}>
            {t(`prog.${p === 'all' ? 'allTime' : p === 'week' ? 'weekly' : p === 'month' ? 'monthly' : 'yearly'}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {/* Stats grid */}
          <div className="prog-stats-grid">
            <div className="card prog-stat-card">
              <div className="prog-stat-value" style={{ color: 'var(--primary)' }}>{periodStats.tasksDone}</div>
              <div className="prog-stat-label">{t('prog.totalTasks')}</div>
            </div>
            <div className="card prog-stat-card">
              <div className="prog-stat-value" style={{ color: '#7c6ff7' }}>{periodStats.journalDays}</div>
              <div className="prog-stat-label">{t('prog.journalDays')}</div>
            </div>
            <div className="card prog-stat-card">
              <div className="prog-stat-value" style={{ color: 'var(--accent)' }}>
                {periodStats.avgMoodVal != null ? MOOD_LABELS[Math.round(periodStats.avgMoodVal + 1)] : '—'}
              </div>
              <div className="prog-stat-label">{t('prog.avgMood')}</div>
            </div>
            <div className="card prog-stat-card">
              <div className="prog-stat-value" style={{ color: 'var(--success)' }}>{periodStats.shiftsWorked}</div>
              <div className="prog-stat-label">{t('prog.shiftsWorked')}</div>
            </div>
          </div>

          {/* Activity heatmap */}
          <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
            <span className="section-title">{t('prog.activity')}</span>
            <div className="heatmap-wrap">
              <div className="heatmap">
                {heatmapData.map((cell) => (
                  <div key={cell.key} className={`heatmap-cell${cell.level ? ` l${cell.level}` : ''}`} title={cell.key} />
                ))}
              </div>
            </div>
          </div>

          {/* Mood chart */}
          {moodChart.some((d) => d.mood != null) && (
            <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
              <span className="section-title">{t('mood.title')} (30 {t('cal.day')}s)</span>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={moodChart}>
                    <defs>
                      <linearGradient id="moodGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="name" fontSize={11} stroke="var(--text-muted)" interval={4} />
                    <YAxis fontSize={11} stroke="var(--text-muted)" domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} width={24} />
                    <Tooltip formatter={(v) => v != null ? MOOD_LABELS[Math.round(v)] : '—'} />
                    <Area type="monotone" dataKey="mood" stroke="var(--primary)" fill="url(#moodGrad)" strokeWidth={2} connectNulls={false} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Badges */}
          <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
              <span className="section-title" style={{ margin: 0 }}>{t('prog.badges')}</span>
              <span className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{unlockedCount}/{BADGES.length} {t('prog.unlocked')}</span>
            </div>
            <div className="badges-grid">
              {badgeStatus.map((b) => (
                <motion.div key={b.id} className={`badge-card ${b.unlocked ? 'unlocked' : 'locked'}`}
                  whileHover={{ scale: b.unlocked ? 1.05 : 1 }}
                  initial={false}
                  animate={b.unlocked ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 0.4 }}>
                  <div className="badge-icon">{b.icon}</div>
                  <div className="badge-name">{b.name}</div>
                  <div className="badge-desc">{b.desc}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'analytics' && (
        <>
          {/* Finance overview */}
          <div className="analytics-block">
            <div className="analytics-block-title">💰 {t('nav.finance')}</div>
            <div className="fin-stats" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="card fin-stat income">
                <span className="text-secondary">{t('fin.income')}</span>
                <span className="amount">{formatMoney(periodStats.income, currency)}</span>
              </div>
              <div className="card fin-stat expense">
                <span className="text-secondary">{t('fin.expense')}</span>
                <span className="amount">{formatMoney(periodStats.expense, currency)}</span>
              </div>
              <div className="card fin-stat">
                <span className="text-secondary">{t('fin.balance')}</span>
                <span className="amount" style={{ color: periodStats.income - periodStats.expense >= 0 ? 'var(--success)' : 'var(--error)' }}>
                  {formatMoney(periodStats.income - periodStats.expense, currency)}
                </span>
              </div>
            </div>
            {financeByCategory.length > 0 && (
              <div className="card">
                <span className="section-title">{t('fin.byCategory')}</span>
                <div className="chart-box" style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={financeByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                        {financeByCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => formatMoney(v, currency)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Productivity */}
          <div className="analytics-block">
            <div className="analytics-block-title">✅ {t('prog.totalTasks')}</div>
            {taskChart.some((d) => d.tasks > 0) ? (
              <div className="card">
                <span className="section-title">{t('tasks.title')} (8 {t('cal.week')}s)</span>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={taskChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="name" fontSize={11} stroke="var(--text-muted)" />
                      <YAxis fontSize={11} stroke="var(--text-muted)" allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="tasks" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="card" style={{ textAlign: 'center', padding: 'var(--space-5)' }}>
                <p className="text-muted">{t('prog.noData')}</p>
              </div>
            )}
          </div>

          {/* Habits */}
          <div className="analytics-block">
            <div className="analytics-block-title">🎯 {t('goals.habits')}</div>
            <div className="grid grid-2">
              <div className="card prog-stat-card">
                <div className="prog-stat-value" style={{ color: 'var(--primary)' }}>{periodStats.habitsDone}</div>
                <div className="prog-stat-label">{t('prog.habitsDone')}</div>
              </div>
              <div className="card prog-stat-card">
                <div className="prog-stat-value" style={{ color: 'var(--accent)' }}>{allStats.savingsCompleted}</div>
                <div className="prog-stat-label">{t('prog.goalsCompleted')}</div>
              </div>
            </div>
          </div>

          {/* Wellness summary */}
          <div className="analytics-block">
            <div className="analytics-block-title">🌟 {t('prog.wellnessIndex')}</div>
            <div className="card">
              {(() => {
                const scores = []
                if (periodStats.tasksDone > 0) scores.push(Math.min(100, periodStats.tasksDone * 10))
                if (periodStats.moodDays > 0 && periodStats.avgMoodVal != null) scores.push(((periodStats.avgMoodVal + 1) / 5) * 100)
                if (periodStats.journalDays > 0) scores.push(Math.min(100, periodStats.journalDays * 10))
                if (periodStats.shiftsWorked > 0) scores.push(Math.min(100, periodStats.shiftsWorked * 15))
                const index = scores.length > 0 ? Math.round(scores.reduce((a, v) => a + v, 0) / scores.length) : 0
                const color = index >= 70 ? 'var(--success)' : index >= 40 ? 'var(--accent)' : 'var(--primary)'
                return (
                  <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
                    <motion.div style={{ fontFamily: 'var(--font-display)', fontSize: 72, fontWeight: 900, color }}
                      initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}>
                      {index}
                    </motion.div>
                    <div style={{ color, fontWeight: 600, marginTop: 4 }}>
                      {index >= 70 ? '🌟 Excellent' : index >= 40 ? '😊 Good' : index > 0 ? '💪 Growing' : '—'}
                    </div>
                    <div className="progress-bar" style={{ marginTop: 'var(--space-3)' }}>
                      <motion.div className="progress-fill" initial={{ width: 0 }} animate={{ width: `${index}%` }}
                        style={{ background: color }} />
                    </div>
                    <p className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>{t('prog.noData').split('—')[0]}</p>
                  </div>
                )
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
