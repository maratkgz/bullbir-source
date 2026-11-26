import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import { toDateKey } from '../../utils/format'
import Modal from '../ui/Modal'
import { Check, Flame, Pencil, Plus, Sprout, Trash2 } from 'lucide-react'
import Icon from '../ui/Icon'

const EMOJIS = ['💪','📚','🏃','🧘','💧','🥗','😴','✍️','🎯','🎵','🧠','❤️','🌅','🚴','🏋️','🧹','🌿','☕','🎨','📝','🤸','🦷']
const COLORS = ['#7c5cff','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6','#f97316','#3b82f6']

function getLast7Days(lang) {
  const days = []
  const dayNames = {
    en: ['S','M','T','W','T','F','S'],
    ru: ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],
    kg: ['Жк','Дш','Сш','Шр','Бш','Жм','Иш'],
  }
  const names = dayNames[lang] || dayNames.en
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push({ key: toDateKey(d), label: names[d.getDay()], date: d })
  }
  return days
}

function calcStreak(completions = []) {
  if (!completions.length) return 0
  const sorted = [...completions].sort().reverse()
  let streak = 0
  const checkDate = new Date()
  for (let i = 0; i < sorted.length; i++) {
    const expected = toDateKey(checkDate)
    if (sorted[i] === expected) {
      streak++
      checkDate.setDate(checkDate.getDate() - 1)
    } else break
  }
  return streak
}

function HabitModal({ habit, onSave, onClose }) {
  const { t } = useLang()
  const [title, setTitle] = useState(habit?.title || '')
  const [emoji, setEmoji] = useState(habit?.emoji || '💪')
  const [color, setColor] = useState(habit?.color || '#7c5cff')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onSave({ title: title.trim(), emoji, color })
  }

  return (
    <Modal open title={habit ? t('habits.editTitle') : t('habits.newTitle')} onClose={onClose}>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="field">
          <label>{t('common.title')}</label>
          <input
            className="input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('habits.placeholder')}
            autoFocus
            required
          />
        </div>

        <div className="field">
          <label>{t('habits.chooseEmoji')}</label>
          <div className="habit-emoji-grid">
            {EMOJIS.map(e => (
              <button
                key={e}
                type="button"
                className={`habit-emoji-btn${emoji === e ? ' selected' : ''}`}
                onClick={() => setEmoji(e)}
              >{e}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('habits.chooseColor')}</label>
          <div className="habit-color-row">
            {COLORS.map(c => (
              <button
                key={c}
                type="button"
                className={`habit-color-dot${color === c ? ' selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>{t('common.save')}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Habits() {
  const { t, lang } = useLang()
  const toast = useToast()
  const { items: habits, loading, add, update, remove } = useCollection('habits', { orderField: 'createdAt', direction: 'asc' })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const days = useMemo(() => getLast7Days(lang), [lang])
  const today = toDateKey()

  const openNew = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (h) => { setEditing(h); setModalOpen(true) }
  const closeModal = () => { setModalOpen(false); setEditing(null) }

  const toggleDay = async (habit, dateKey) => {
    const completions = habit.completions || []
    const next = completions.includes(dateKey)
      ? completions.filter(d => d !== dateKey)
      : [...completions, dateKey]
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...clean } = habit
    try {
      await update(habit.id, { ...clean, completions: next })
    } catch {
      toast.error(t('common.error'))
    }
  }

  const save = async (data) => {
    try {
      if (editing) {
        const { id: _id, createdAt: _ca, updatedAt: _ua, ...clean } = editing
        await update(editing.id, { ...clean, ...data })
      } else {
        await add({ ...data, completions: [] })
      }
      toast.success(t('common.saved'))
      closeModal()
    } catch {
      toast.error(t('common.error'))
    }
  }

  const del = async (habit) => {
    try {
      await remove(habit.id)
      setConfirmDel(null)
      toast.success(t('habits.deleted'))
    } catch {
      toast.error(t('common.error'))
    }
  }

  const totalDone = useMemo(() =>
    habits.filter(h => (h.completions || []).includes(today)).length,
    [habits, today]
  )

  return (
    <div>
      {/* Header */}
      <div className="module-header">
        <div>
          <h2>{t('habits.title')}</h2>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {totalDone}/{habits.length} {t('habits.doneToday')}
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <Icon icon={Plus} size={18} />
          {t('habits.newTitle')}
        </button>
      </div>

      {loading ? (
        <div className="list-stack">
          {[0,1,2,3].map(i => (
            <div key={i} className="card" style={{ height: 60, background: 'var(--surface)' }}>
              <div className="skeleton-pulse" style={{ height: '100%', borderRadius: 'var(--radius-md)' }} />
            </div>
          ))}
        </div>
      ) : habits.length === 0 ? (
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center', padding: 'var(--space-9) var(--space-5)' }}
        >
          <div style={{ fontSize: 56, marginBottom: 'var(--space-3)' }}><Icon icon={Sprout} size="1em" /></div>
          <h3 style={{ marginBottom: 'var(--space-2)' }}>{t('habits.emptyTitle')}</h3>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-5)' }}>{t('habits.emptyHint')}</p>
          <button className="btn btn-primary" onClick={openNew}>{t('habits.newTitle')}</button>
        </motion.div>
      ) : (
        <>
          {/* Desktop: weekly grid */}
          <div className="habits-grid-wrap card">
            {/* Header row */}
            <div className="habits-grid-header">
              <div className="habits-grid-name-col">{t('habits.habit')}</div>
              {days.map(d => (
                <div key={d.key} className={`habits-grid-day-col${d.key === today ? ' today' : ''}`}>
                  {d.label}
                </div>
              ))}
              <div className="habits-grid-streak-col"><Icon icon={Flame} size="1em" label={t('habits.daysStreak')} /></div>
              <div style={{ width: 32 }} />
            </div>

            {/* Habit rows */}
            {habits.map((habit, i) => {
              const completions = habit.completions || []
              const streak = calcStreak(completions)
              return (
                <motion.div
                  key={habit.id}
                  className="habits-grid-row"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <div className="habits-grid-name-col">
                    <span className="habits-emoji-badge" style={{ background: habit.color + '22', color: habit.color }}>
                      {habit.emoji}
                    </span>
                    <span className="habits-name-text">{habit.title}</span>
                  </div>
                  {days.map(d => {
                    const done = completions.includes(d.key)
                    return (
                      <div key={d.key} className="habits-grid-day-col">
                        <button
                          className={`habits-dot${done ? ' done' : ''}`}
                          style={done ? { background: habit.color, borderColor: habit.color } : {}}
                          onClick={() => toggleDay(habit, d.key)}
                          title={d.key}
                          aria-label={`Отметить ${d.key}`}
                          aria-pressed={done}
                        >
                          {done && (
                            <Icon icon={Check} size={10} style={{ color: '#fff' }} />
                          )}
                        </button>
                      </div>
                    )
                  })}
                  <div className="habits-grid-streak-col" style={{ fontWeight: 700, color: streak > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {streak}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-icon btn-ghost" style={{ width: 32, height: 32, minHeight: 'unset', padding: 0 }} onClick={() => openEdit(habit)} aria-label="Изменить привычку">
                      <Icon icon={Pencil} size={14} />
                    </button>
                    <button className="btn btn-icon btn-ghost" style={{ width: 32, height: 32, minHeight: 'unset', padding: 0, color: 'var(--error)' }} onClick={() => setConfirmDel(habit)} aria-label="Удалить привычку">
                      <Icon icon={Trash2} size={14} />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>

          {/* Mobile: card list */}
          <div className="habits-cards-list">
            {habits.map((habit, i) => {
              const completions = habit.completions || []
              const streak = calcStreak(completions)
              const doneToday = completions.includes(today)
              return (
                <motion.div
                  key={habit.id}
                  className="habits-card card"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <div className="habits-card-left">
                    <span
                      className="habits-card-icon"
                      style={{ background: habit.color + '22', color: habit.color }}
                    >{habit.emoji}</span>
                    <div>
                      <div className="habits-card-name">{habit.title}</div>
                      <div className="habits-card-meta">
                        {streak > 0 ? (
                          <span style={{ color: 'var(--accent)', fontWeight: 700 }}><Icon icon={Flame} size="1em" /> {streak} {t('habits.daysStreak')}</span>
                        ) : (
                          <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{t('habits.noStreak')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="habits-card-right">
                    <button
                      className="btn btn-icon btn-ghost"
                      style={{ color: 'var(--text-muted)' }}
                      onClick={() => openEdit(habit)}
                      aria-label="Изменить привычку"
                    >
                      <Icon icon={Pencil} size={16} />
                    </button>
                    <button
                      className={`habits-check-btn${doneToday ? ' done' : ''}`}
                      style={doneToday ? { background: habit.color, borderColor: habit.color } : {}}
                      onClick={() => toggleDay(habit, today)}
                      aria-label="Отметить сегодня"
                      aria-pressed={doneToday}
                    >
                      <Icon icon={Check} size={18} />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </>
      )}

      {/* Add/Edit modal */}
      <AnimatePresence>
        {modalOpen && (
          <HabitModal habit={editing} onSave={save} onClose={closeModal} />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {confirmDel && (
          <Modal open title={t('habits.deleteTitle')} onClose={() => setConfirmDel(null)}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-5)' }}>
              {t('habits.deleteConfirm').replace('{name}', confirmDel.title)}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmDel(null)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => del(confirmDel)}>{t('common.delete')}</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}
