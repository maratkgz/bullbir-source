import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import { toDateKey } from '../../utils/format'

const GOAL_COLORS = [
  '#7c5cff', '#5ad1a5', '#f0a45a', '#e06a9a', '#9a8cff', '#f0c45a', '#60b8ff'
]
const GOAL_EMOJIS = ['🎯', '💰', '🏋️', '📚', '🧘', '✈️', '💻', '🎸', '🏃', '🌱', '🎨', '❤️']

function goalPct(goal) {
  const ms = goal.milestones || []
  if (ms.length === 0) {
    if (goal.target && goal.current !== undefined) {
      return Math.min(100, Math.round((goal.current / goal.target) * 100))
    }
    return 0
  }
  return Math.round((ms.filter(m => m.done).length / ms.length) * 100)
}

function GoalCard({ goal, onToggleMilestone, onArchive, onDelete, onClick }) {
  const { t } = useLang()
  const pct = goalPct(goal)
  const ms = goal.milestones || []
  const done = ms.filter(m => m.done).length
  const color = goal.color || '#7c5cff'
  const isCompleted = goal.archived || pct === 100

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="goal-card card"
      style={{
        borderColor: !isCompleted && goal.selected ? color : undefined,
        borderWidth: !isCompleted && goal.selected ? 1.5 : undefined,
        opacity: isCompleted ? 0.78 : 1,
        background: isCompleted ? 'var(--bg-secondary)' : undefined,
        cursor: 'pointer',
      }}
      onClick={() => onClick(goal)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, position: 'relative' }}>
        <div style={{
          width: 46, height: 46, borderRadius: 13, flexShrink: 0,
          background: `${color}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, position: 'relative',
        }}>
          {goal.emoji || '🎯'}
          {isCompleted && (
            <span style={{
              position: 'absolute', bottom: -3, right: -3,
              width: 18, height: 18, borderRadius: '50%',
              background: '#5ad1a5', border: '2px solid var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: '#fff',
            }}>✓</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: isCompleted ? 'var(--text-secondary)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {goal.title}
          </div>
          {isCompleted
            ? <div style={{ fontSize: 12.5, color: '#5ad1a5', fontWeight: 600, marginTop: 1 }}>Завершено 🎉</div>
            : ms.length > 0
              ? <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500, marginTop: 1 }}>{done} из {ms.length}</div>
              : goal.deadline
                ? <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500, marginTop: 1 }}>До {goal.deadline}</div>
                : null
          }
        </div>
        <button
          style={{ color: 'var(--text-muted)', padding: 4, fontSize: 18 }}
          onClick={e => { e.stopPropagation(); onDelete(goal.id) }}
        >×</button>
      </div>

      <div style={{
        height: 9, background: 'var(--bg)', borderRadius: 99, overflow: 'hidden', marginTop: 18,
      }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          style={{
            height: '100%', borderRadius: 99,
            background: isCompleted ? '#5ad1a5' : `linear-gradient(90deg, ${color}, ${color}cc)`,
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>
          {goal.deadline ? `До ${goal.deadline}` : 'Без срока'}
        </span>
        <span style={{ fontSize: 18, fontWeight: 800, color: isCompleted ? '#5ad1a5' : color }}>
          {pct}%
        </span>
      </div>

      {ms.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
          {ms.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className={`task-checkbox${m.done ? ' checked' : ''}`}
                style={{ width: 20, height: 20, borderRadius: 6 }}
                onClick={e => { e.stopPropagation(); onToggleMilestone(goal, i) }}
              >
                {m.done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
              </button>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: m.done ? 'var(--text-muted)' : 'var(--text)', textDecoration: m.done ? 'line-through' : 'none' }}>{m.title}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

function GoalForm({ onSave, onClose }) {
  const { t } = useLang()
  const [form, setForm] = useState({ title: '', description: '', emoji: '🎯', color: '#7c5cff', deadline: '', milestones: [] })
  const [msInput, setMsInput] = useState('')

  const addMs = () => {
    if (msInput.trim()) {
      setForm(f => ({ ...f, milestones: [...f.milestones, { title: msInput.trim(), done: false }] }))
      setMsInput('')
    }
  }

  return (
    <div>
      <div className="field">
        <label>{t('common.title')}</label>
        <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus />
      </div>

      <div className="field">
        <label>Иконка</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {GOAL_EMOJIS.map(em => (
            <button
              key={em} type="button"
              onClick={() => setForm(f => ({ ...f, emoji: em }))}
              style={{
                width: 40, height: 40, borderRadius: 10, fontSize: 20,
                background: form.emoji === em ? 'var(--primary-light)' : 'var(--surface-2)',
                border: `1px solid ${form.emoji === em ? 'var(--primary-border)' : 'var(--border)'}`,
              }}
            >{em}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Цвет</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {GOAL_COLORS.map(c => (
            <button
              key={c} type="button"
              onClick={() => setForm(f => ({ ...f, color: c }))}
              style={{
                width: 32, height: 32, borderRadius: '50%', background: c, flexShrink: 0,
                border: `3px solid ${form.color === c ? '#fff' : 'transparent'}`,
                outline: form.color === c ? `2px solid ${c}` : 'none',
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>{t('common.description')} <span style={{ color: 'var(--text-muted)' }}>({t('common.optional')})</span></label>
          <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="field">
          <label>Срок</label>
          <input type="date" className="input" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
        </div>
      </div>

      <div className="field">
        <label>{t('goals.milestones')}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.milestones.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 13.5 }}>• {m.title}</span>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setForm(f => ({ ...f, milestones: f.milestones.filter((_, j) => j !== i) }))}>×</button>
            </div>
          ))}
          <div className="chip-input">
            <input
              className="input" style={{ flex: 1 }} value={msInput}
              onChange={e => setMsInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addMs())}
              placeholder={t('goals.addMilestone')}
            />
            <button type="button" className="btn btn-secondary" onClick={addMs}>{t('common.add')}</button>
          </div>
        </div>
      </div>

      <button
        className="btn btn-primary" style={{ width: '100%', marginTop: 4 }}
        onClick={() => { if (form.title.trim()) { onSave(form); onClose() } }}
      >{t('common.save')}</button>
    </div>
  )
}

export default function Goals() {
  const { items, add, update, remove } = useCollection('goals')
  const { t } = useLang()
  const toast = useToast()
  const [tab, setTab] = useState('active') // active | done
  const [modalOpen, setModalOpen] = useState(false)

  const activeGoals = items.filter(g => !g.archived && goalPct(g) < 100)
  const doneGoals = items.filter(g => g.archived || goalPct(g) === 100)
  const display = tab === 'active' ? activeGoals : doneGoals

  const saveGoal = async (form) => {
    await add({ ...form, archived: false })
    toast.success(t('common.saved'))
  }

  const toggleMilestone = (goal, index) => {
    const ms = (goal.milestones || []).map((m, i) => i === index ? { ...m, done: !m.done } : m)
    update(goal.id, { milestones: ms })
  }

  const clickGoal = (goal) => {
    // mark today done if no milestones
    if ((goal.milestones || []).length === 0) return
  }

  return (
    <div>
      <div className="module-header">
        <div>
          <h2 style={{ letterSpacing: '-0.02em' }}>{t('nav.goals')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {activeGoals.length} активных
            {doneGoals.length > 0 && ` · ${doneGoals.length} завершено`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t('goals.newGoal')}
        </button>
      </div>

      <div className="tasks-tabs">
        <button className={`tasks-tab${tab === 'active' ? ' active' : ''}`} onClick={() => setTab('active')}>
          {t('common.active') || 'Активные'} {activeGoals.length > 0 && `(${activeGoals.length})`}
        </button>
        <button className={`tasks-tab${tab === 'done' ? ' active' : ''}`} onClick={() => setTab('done')}>
          {t('tasks.done') || 'Готово'} {doneGoals.length > 0 && `(${doneGoals.length})`}
        </button>
      </div>

      {display.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', marginTop: 16 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{tab === 'done' ? '🏆' : '🎯'}</div>
          <h3>{tab === 'done' ? 'Нет завершённых целей' : t('goals.empty')}</h3>
          {tab === 'active' && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setModalOpen(true)}>
              + {t('goals.newGoal')}
            </button>
          )}
        </div>
      ) : (
        <div className="goals-grid">
          <AnimatePresence>
            {display.map(g => (
              <GoalCard
                key={g.id}
                goal={g}
                onToggleMilestone={toggleMilestone}
                onArchive={id => update(id, { archived: !g.archived })}
                onDelete={remove}
                onClick={clickGoal}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('goals.newGoal')}>
        <GoalForm onSave={saveGoal} onClose={() => setModalOpen(false)} />
      </Modal>
    </div>
  )
}
