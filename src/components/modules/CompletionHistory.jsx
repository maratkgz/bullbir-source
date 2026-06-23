import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { toDate, toDateKey } from '../../utils/format'
import EmptyState from '../ui/EmptyState'

function getColor(rate, count) {
  if (count === 0) return 'var(--bg-card)'
  if (rate === 0) return '#ef4444'
  if (rate < 0.4) return '#f97316'
  if (rate < 0.7) return '#eab308'
  if (rate < 1) return '#22c55e'
  return '#16a34a'
}

function buildDayMap(tasks) {
  const map = {}
  tasks.forEach(task => {
    let dateKey = null
    if (task.completedAt) {
      const d = toDate(task.completedAt)
      if (d) dateKey = toDateKey(d)
    } else if (task.skippedAt) {
      const d = toDate(task.skippedAt)
      if (d) dateKey = toDateKey(d)
    } else if (task.deadline) {
      const d = toDate(task.deadline)
      if (d) dateKey = toDateKey(d)
    }
    if (!dateKey) return
    if (!map[dateKey]) map[dateKey] = { done: [], skipped: [], overdue: [] }
    if (task.status === 'done') map[dateKey].done.push(task)
    else if (task.status === 'skipped') map[dateKey].skipped.push(task)
    else {
      const dl = toDate(task.deadline)
      if (dl && dl < new Date(toDateKey())) map[dateKey].overdue.push(task)
    }
  })
  return map
}

function Heatmap({ tasks, t }) {
  const [tooltip, setTooltip] = useState(null)
  const days = useMemo(() => {
    const result = []
    const today = new Date(toDateKey())
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      result.push(toDateKey(d))
    }
    return result
  }, [])

  const dayMap = useMemo(() => buildDayMap(tasks), [tasks])

  return (
    <div className="hist-heatmap-wrap">
      <div className="hist-heatmap">
        {days.map(day => {
          const entry = dayMap[day]
          const done = entry?.done.length || 0
          const skipped = entry?.skipped.length || 0
          const overdue = entry?.overdue.length || 0
          const total = done + skipped + overdue
          const rate = total > 0 ? done / total : 0
          return (
            <div
              key={day}
              className="hist-cell"
              style={{ background: getColor(rate, total) }}
              onMouseEnter={() => setTooltip({ day, done, skipped, overdue, total })}
              onMouseLeave={() => setTooltip(null)}
              title={`${day}: ${done} done, ${skipped} skipped, ${overdue} overdue`}
            />
          )
        })}
      </div>
      {tooltip && (
        <div className="hist-tooltip">
          <strong>{tooltip.day}</strong>
          {tooltip.total === 0 ? (
            <span className="text-muted">{t('hist.noActivity')}</span>
          ) : (
            <>
              <span>✓ {tooltip.done} {t('hist.done')}</span>
              <span>⊘ {tooltip.skipped} {t('hist.skipped')}</span>
              {tooltip.overdue > 0 && <span style={{ color: '#ef4444' }}>⚠ {tooltip.overdue} {t('hist.overdue')}</span>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function streak(tasks) {
  const doneKeys = new Set(
    tasks
      .filter(t => t.status === 'done' && t.completedAt)
      .map(t => { const d = toDate(t.completedAt); return d ? toDateKey(d) : null })
      .filter(Boolean)
  )
  let count = 0
  const today = new Date(toDateKey())
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    if (doneKeys.has(toDateKey(d))) count++
    else if (i > 0) break
  }
  return count
}

export default function CompletionHistory() {
  const { items: tasks, loading } = useCollection('tasks')
  const { t } = useLang()
  const [filter, setFilter] = useState('all')

  const filtered = useMemo(() => {
    if (filter === 'done') return tasks.filter(t => t.status === 'done')
    if (filter === 'skipped') return tasks.filter(t => t.status === 'skipped')
    if (filter === 'ai') return tasks.filter(t => t.aiGenerated)
    return tasks
  }, [tasks, filter])

  const metrics = useMemo(() => {
    const done = tasks.filter(t => t.status === 'done').length
    const skipped = tasks.filter(t => t.status === 'skipped').length
    const total = done + skipped
    const aiDone = tasks.filter(t => t.aiGenerated && t.status === 'done').length
    return {
      done,
      skipRate: total > 0 ? Math.round((skipped / total) * 100) : 0,
      streak: streak(tasks),
      aiDone,
    }
  }, [tasks])

  // Group filtered tasks by date for list view
  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(task => {
      let dateKey = null
      if (task.completedAt) { const d = toDate(task.completedAt); if (d) dateKey = toDateKey(d) }
      else if (task.skippedAt) { const d = toDate(task.skippedAt); if (d) dateKey = toDateKey(d) }
      else if (task.deadline) { const d = toDate(task.deadline); if (d) dateKey = toDateKey(d) }
      if (!dateKey) return
      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(task)
    })
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const today = toDateKey()
  const yesterday = (() => { const d = new Date(today); d.setDate(d.getDate() - 1); return toDateKey(d) })()

  const dateLabel = (key) => {
    if (key === today) return t('common.today')
    if (key === yesterday) return t('common.yesterday')
    return key
  }

  const statusIcon = (status) => {
    if (status === 'done') return <span style={{ color: '#22c55e' }}>✓</span>
    if (status === 'skipped') return <span style={{ color: 'var(--text-muted)' }}>⊘</span>
    return <span style={{ color: '#ef4444' }}>⚠</span>
  }

  if (loading) return <div className="page-loading">{t('common.loading')}</div>

  return (
    <div>
      <div className="page-header">
        <h1>{t('hist.title')}</h1>
      </div>

      {/* Metrics */}
      <div className="hist-metrics">
        <motion.div className="hist-metric-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <span className="hist-metric-val" style={{ color: '#22c55e' }}>{metrics.done}</span>
          <span className="hist-metric-label">{t('hist.totalDone')}</span>
        </motion.div>
        <motion.div className="hist-metric-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <span className="hist-metric-val" style={{ color: metrics.skipRate > 30 ? '#ef4444' : 'var(--text)' }}>{metrics.skipRate}%</span>
          <span className="hist-metric-label">{t('hist.skipRate')}</span>
        </motion.div>
        <motion.div className="hist-metric-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
          <span className="hist-metric-val" style={{ color: 'var(--primary)' }}>{metrics.streak}</span>
          <span className="hist-metric-label">{t('hist.streak')} ({t('hist.days')})</span>
        </motion.div>
        <motion.div className="hist-metric-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <span className="hist-metric-val">✨ {metrics.aiDone}</span>
          <span className="hist-metric-label">{t('hist.aiDone')}</span>
        </motion.div>
      </div>

      {/* Heatmap */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <h3 className="prof-card-title">{t('hist.heatmap')}</h3>
        <Heatmap tasks={tasks} t={t} />
        <div className="hist-legend">
          <span style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} className="hist-legend-dot" /> {t('hist.noActivity').split(' ')[0]}
          <span style={{ background: '#ef4444' }} className="hist-legend-dot" /> 0%
          <span style={{ background: '#eab308' }} className="hist-legend-dot" /> 40%
          <span style={{ background: '#22c55e' }} className="hist-legend-dot" /> 70%
          <span style={{ background: '#16a34a' }} className="hist-legend-dot" /> 100%
        </div>
      </div>

      {/* Filter */}
      <div className="hist-filters">
        {[
          { key: 'all', label: t('hist.all') },
          { key: 'done', label: t('hist.done') },
          { key: 'skipped', label: t('hist.skipped') },
          { key: 'ai', label: '✨ AI' },
        ].map(f => (
          <button key={f.key} className={`hist-filter-btn ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {grouped.length === 0 ? (
        <EmptyState message={t('hist.noData')} />
      ) : (
        <div className="hist-list">
          {grouped.map(([dateKey, dayTasks]) => (
            <motion.div key={dateKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hist-day-group">
              <div className="hist-day-header">
                <span className="hist-day-label">{dateLabel(dateKey)}</span>
                <span className="hist-day-count">
                  <span style={{ color: '#22c55e' }}>✓ {dayTasks.filter(t => t.status === 'done').length}</span>
                  {dayTasks.some(t => t.status === 'skipped') && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>⊘ {dayTasks.filter(t => t.status === 'skipped').length}</span>}
                </span>
              </div>
              {dayTasks.map(task => (
                <div key={task.id} className="hist-task-row">
                  <span className="hist-task-icon">{statusIcon(task.status)}</span>
                  <span className="hist-task-title">
                    {task.aiGenerated && <span style={{ opacity: 0.7, marginRight: 4 }}>✨</span>}
                    {task.title}
                  </span>
                  <span className={`prio prio-${task.priority || 'medium'}`} style={{ fontSize: 'var(--text-xs)' }}>
                    {task.priority || 'medium'}
                  </span>
                  {task.skipReason && (
                    <span className="hist-skip-reason" title={task.skipReason}>"{task.skipReason.slice(0, 30)}{task.skipReason.length > 30 ? '…' : ''}"</span>
                  )}
                </div>
              ))}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
