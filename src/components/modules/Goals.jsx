import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { subDays, eachDayOfInterval } from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import EmptyState from '../ui/EmptyState'
import { toDateKey } from '../../utils/format'

function GoalCard({ goal, onUpdate, onDelete }) {
  const { t } = useLang()
  const milestones = goal.milestones || []
  const done = milestones.filter((m) => m.done).length
  const pct = milestones.length ? Math.round((done / milestones.length) * 100) : 0

  const toggleMs = (i) => {
    const next = milestones.map((m, j) => (j === i ? { ...m, done: !m.done } : m))
    onUpdate(goal.id, { milestones: next })
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="card goal-card">
      <div className="flex items-center justify-between">
        <h3>{goal.title}</h3>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-icon" onClick={() => onUpdate(goal.id, { archived: !goal.archived })} aria-label={t('goals.archive')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => onDelete(goal.id)}>×</button>
        </div>
      </div>
      {goal.description && <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>{goal.description}</p>}
      <div className="progress-bar"><motion.div className="progress-fill" initial={{ width: 0 }} animate={{ width: `${pct}%` }} /></div>
      <span className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{pct}% · {done}/{milestones.length}</span>
      <div className="list-stack">
        {milestones.map((m, i) => (
          <div key={i} className="milestone">
            <button className={`checkbox ${m.done ? 'checked' : ''}`} onClick={() => toggleMs(i)}>
              {m.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>}
            </button>
            <span style={{ textDecoration: m.done ? 'line-through' : 'none', color: m.done ? 'var(--text-muted)' : 'var(--text)' }}>{m.title}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

function HabitCard({ habit, onUpdate, onDelete }) {
  const { t } = useLang()
  const log = habit.log || {}
  const todayKey = toDateKey()
  const checkedToday = !!log[todayKey]

  const days = useMemo(() => eachDayOfInterval({ start: subDays(new Date(), 118), end: new Date() }), [])
  const streak = useMemo(() => {
    let count = 0
    let d = new Date()
    while (log[toDateKey(d)]) { count += 1; d = subDays(d, 1) }
    return count
  }, [log])

  const toggleToday = () => {
    const next = { ...log }
    if (next[todayKey]) delete next[todayKey]
    else next[todayKey] = true
    onUpdate(habit.id, { log: next })
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="card goal-card">
      <div className="flex items-center justify-between">
        <h3>{habit.title}</h3>
        <button className="btn btn-ghost btn-icon" onClick={() => onDelete(habit.id)}>×</button>
      </div>
      <span className="streak-badge">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3-1 5-2 6 2 0 4 2 4 5a4 4 0 0 1-8 0c0-2 1-3 1-3s3 1 2-3c2 1 4 4 1 6 3-1 5-4 5-7 0-4-3-6-4-7Z" /></svg>
        {streak} {t('goals.streak')}
      </span>
      <div className="habit-grid">
        {days.map((d) => {
          const k = toDateKey(d)
          return <div key={k} className={`habit-cell ${log[k] ? 'l4' : ''}`} title={k} />
        })}
      </div>
      <button className={`btn ${checkedToday ? 'btn-secondary' : 'btn-primary'} btn-block`} onClick={toggleToday}>
        {checkedToday ? '✓ ' + t('common.done') : t('goals.markDone')}
      </button>
    </motion.div>
  )
}

export default function Goals() {
  const goals = useCollection('goals')
  const habits = useCollection('habits')
  const { t } = useLang()
  const toast = useToast()
  const [tab, setTab] = useState('goals')
  const [showArchived, setShowArchived] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', milestones: [] })
  const [msInput, setMsInput] = useState('')

  const visibleGoals = goals.items.filter((g) => !!g.archived === showArchived)

  const saveGoal = async () => {
    if (!form.title.trim()) return
    await goals.add({ title: form.title.trim(), description: form.description.trim(), milestones: form.milestones, archived: false })
    toast.success(t('common.saved'))
    setForm({ title: '', description: '', milestones: [] })
    setModalOpen(false)
  }
  const saveHabit = async () => {
    if (!form.title.trim()) return
    await habits.add({ title: form.title.trim(), log: {} })
    toast.success(t('common.saved'))
    setForm({ title: '', description: '', milestones: [] })
    setModalOpen(false)
  }

  return (
    <div>
      <div className="page-header">
        <div className="view-toggle">
          <button className={tab === 'goals' ? 'active' : ''} onClick={() => setTab('goals')}>{t('goals.goals')}</button>
          <button className={tab === 'habits' ? 'active' : ''} onClick={() => setTab('habits')}>{t('goals.habits')}</button>
        </div>
        <div className="flex gap-3 items-center">
          {tab === 'goals' && (
            <button className="btn btn-ghost" onClick={() => setShowArchived((s) => !s)}>{showArchived ? t('common.all') : t('goals.archived')}</button>
          )}
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ {tab === 'goals' ? t('goals.newGoal') : t('goals.newHabit')}</button>
        </div>
      </div>

      {tab === 'goals' ? (
        visibleGoals.length === 0 ? (
          <EmptyState message={t('goals.empty')} action={<button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ {t('goals.newGoal')}</button>} />
        ) : (
          <div className="grid grid-2">
            <AnimatePresence>
              {visibleGoals.map((g) => <GoalCard key={g.id} goal={g} onUpdate={goals.update} onDelete={goals.remove} />)}
            </AnimatePresence>
          </div>
        )
      ) : habits.items.length === 0 ? (
        <EmptyState message={t('goals.habitsEmpty')} action={<button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ {t('goals.newHabit')}</button>} />
      ) : (
        <div className="grid grid-2">
          <AnimatePresence>
            {habits.items.map((h) => <HabitCard key={h.id} habit={h} onUpdate={habits.update} onDelete={habits.remove} />)}
          </AnimatePresence>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={tab === 'goals' ? t('goals.newGoal') : t('goals.newHabit')}>
        <div className="field">
          <label>{t('common.title')}</label>
          <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} autoFocus />
        </div>
        {tab === 'goals' && (
          <>
            <div className="field">
              <label>{t('common.description')} <span className="text-muted">({t('common.optional')})</span></label>
              <textarea className="textarea" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="field">
              <label>{t('goals.milestones')}</label>
              <div className="list-stack">
                {form.milestones.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span style={{ flex: 1 }}>• {m.title}</span>
                    <button className="btn btn-ghost btn-icon" onClick={() => setForm((f) => ({ ...f, milestones: f.milestones.filter((_, j) => j !== i) }))}>×</button>
                  </div>
                ))}
                <div className="chip-input">
                  <input className="input" style={{ flex: 1 }} value={msInput} onChange={(e) => setMsInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (msInput.trim()) { setForm((f) => ({ ...f, milestones: [...f.milestones, { title: msInput.trim(), done: false }] })); setMsInput('') } } }} placeholder={t('goals.addMilestone')} />
                  <button className="btn btn-secondary" onClick={() => { if (msInput.trim()) { setForm((f) => ({ ...f, milestones: [...f.milestones, { title: msInput.trim(), done: false }] })); setMsInput('') } }}>{t('common.add')}</button>
                </div>
              </div>
            </div>
          </>
        )}
        <button className="btn btn-primary btn-block" onClick={tab === 'goals' ? saveGoal : saveHabit}>{t('common.save')}</button>
      </Modal>
    </div>
  )
}
