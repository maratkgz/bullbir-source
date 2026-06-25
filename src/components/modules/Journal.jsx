import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import { toDateKey } from '../../utils/format'

const MOODS = [
  { value: 0, emoji: '😔', label: 'Плохо',   color: '#e06a9a', height: 25 },
  { value: 1, emoji: '😕', label: 'Грустно', color: '#f0a45a', height: 45 },
  { value: 2, emoji: '😐', label: 'Нейтрально', color: '#9a9aab', height: 55 },
  { value: 3, emoji: '🙂', label: 'Хорошо',  color: '#5ad1a5', height: 75 },
  { value: 4, emoji: '😄', label: 'Отлично', color: '#7c5cff', height: 100 },
]
const MOOD_HEIGHTS = [25, 45, 55, 75, 100]

function moodEmoji(v) { return MOODS.find(m => m.value === v)?.emoji || '' }
function moodColor(v) { return MOODS.find(m => m.value === v)?.color || '#7c5cff' }

function countWords(text) {
  return text ? text.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length : 0
}

function WeekMood({ items }) {
  const { lang } = useLang()
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - 6 + i)
    return d
  })
  const entryMap = useMemo(() => {
    const m = {}
    items.forEach(e => { m[e.date || toDateKey(new Date(e.createdAt?.seconds * 1000 || Date.now()))] = e.mood })
    return m
  }, [items])

  const dayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const today = toDateKey()

  return (
    <div className="card journal-week-mood">
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
        Эта неделя
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        {days.map((d, i) => {
          const key = toDateKey(d)
          const mood = entryMap[key]
          const label = dayLabels[d.getDay() === 0 ? 6 : d.getDay() - 1]
          const isToday = key === today
          return (
            <div key={key} style={{ flex: 1, textAlign: 'center', opacity: key > today ? 0.35 : 1 }}>
              {mood !== undefined
                ? <span style={{ fontSize: 20 }}>{moodEmoji(mood)}</span>
                : <span style={{ width: 20, height: 20, borderRadius: '50%', border: '2px dashed var(--border-strong)', display: 'inline-block' }} />
              }
              <div style={{ fontSize: 10, color: isToday ? '#9a8cff' : 'var(--text-muted)', fontWeight: isToday ? 700 : 600, marginTop: 5 }}>
                {label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MoodChart({ items }) {
  const last14 = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - 13 + i)
      return toDateKey(d)
    })
    const map = {}
    items.forEach(e => { if (e.mood !== undefined) map[e.date || toDateKey()] = e.mood })
    return days.map(k => ({ k, mood: map[k] }))
  }, [items])

  if (items.filter(e => e.mood !== undefined).length < 2) return null

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Настроение за 2 недели</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4, height: 100 }}>
        {last14.map(({ k, mood }) => (
          <div key={k} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{
              width: 9, borderRadius: 99,
              height: mood !== undefined ? `${MOOD_HEIGHTS[mood]}%` : '8%',
              background: mood !== undefined ? moodColor(mood) : 'var(--border-subtle)',
              transition: 'height 0.3s',
            }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function EntryCard({ entry, onDelete, onEdit }) {
  const date = entry.date ? new Date(entry.date) : entry.createdAt ? new Date(entry.createdAt.seconds * 1000) : new Date()
  const dateStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const preview = (entry.content || '').replace(/<[^>]+>/g, ' ').slice(0, 180)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="card journal-entry-card"
      onClick={() => onEdit(entry)}
      style={{ cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        {entry.mood !== undefined && (
          <span style={{ fontSize: 26, flexShrink: 0 }}>{moodEmoji(entry.mood)}</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {entry.title || 'Без названия'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500, marginTop: 1 }}>
            {dateStr}, {timeStr}
          </div>
        </div>
        {entry.tags?.length > 0 && (
          <div style={{ display: 'flex', gap: 5 }}>
            {entry.tags.slice(0, 2).map(tag => (
              <span key={tag} className="journal-tag">{tag}</span>
            ))}
          </div>
        )}
        <button
          style={{ color: 'var(--text-muted)', padding: 4, fontSize: 18 }}
          onClick={e => { e.stopPropagation(); onDelete(entry.id) }}
        >×</button>
      </div>
      {preview && (
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {preview}{entry.content?.length > 180 ? '...' : ''}
        </div>
      )}
      {entry.tags?.length > 2 && (
        <div style={{ display: 'flex', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
          {entry.tags.slice(2).map(tag => (
            <span key={tag} className="journal-tag">{tag}</span>
          ))}
        </div>
      )}
    </motion.div>
  )
}

function EntryModal({ open, onClose, entry, onSave }) {
  const { t } = useLang()
  const [form, setForm] = useState({ title: '', content: '', mood: null, tags: [], date: toDateKey() })
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (entry) setForm({ title: entry.title || '', content: entry.content || '', mood: entry.mood ?? null, tags: entry.tags || [], date: entry.date || toDateKey() })
    else setForm({ title: '', content: '', mood: null, tags: [], date: toDateKey() })
    setTagInput('')
  }, [entry, open])

  const addTag = () => {
    const v = tagInput.trim()
    if (v && !form.tags.includes(v)) setForm(f => ({ ...f, tags: [...f.tags, v] }))
    setTagInput('')
  }

  return (
    <Modal open={open} onClose={onClose} title={entry ? 'Редактировать запись' : 'Новая запись'} maxWidth={560}>
      <div className="field">
        <label>Заголовок</label>
        <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus placeholder="Как прошёл день?" />
      </div>

      <div className="field">
        <label>Настроение</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {MOODS.map(m => (
            <button
              key={m.value} type="button"
              onClick={() => setForm(f => ({ ...f, mood: f.mood === m.value ? null : m.value }))}
              style={{
                width: 44, height: 44, borderRadius: 12, fontSize: 22,
                background: form.mood === m.value ? 'var(--primary-light)' : 'var(--surface-2)',
                border: `1px solid ${form.mood === m.value ? 'var(--primary-border)' : 'var(--border)'}`,
                transition: 'all 0.15s',
              }}
            >{m.emoji}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Запись</label>
        <textarea
          className="textarea"
          rows={8}
          value={form.content}
          onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          placeholder={t('journal.placeholder') || 'Что происходило сегодня? Как ты себя чувствуешь?'}
          style={{ resize: 'vertical', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}
        />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {countWords(form.content)} слов
        </div>
      </div>

      <div className="field">
        <label>Теги</label>
        <div className="chip-input">
          {form.tags.map(tag => (
            <span key={tag} className="chip-removable">#{tag}
              <button type="button" onClick={() => setForm(f => ({ ...f, tags: f.tags.filter(x => x !== tag) }))}>×</button>
            </span>
          ))}
          <input
            className="input" style={{ flex: 1, minWidth: 100 }} value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="добавить тег..."
          />
        </div>
      </div>

      <div className="field">
        <label>Дата</label>
        <input type="date" className="input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
      </div>

      <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} onClick={() => onSave(form)}>
        {t('common.save')}
      </button>
    </Modal>
  )
}

export default function Journal() {
  const { items, loading, add, update, remove } = useCollection('entries', { orderField: 'createdAt', direction: 'desc' })
  const { t } = useLang()
  const toast = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const save = async (form) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...clean } = form
    if (editing) await update(editing.id, clean)
    else await add(clean)
    toast.success(t('common.saved'))
    setModalOpen(false); setEditing(null)
  }

  const openEdit = (entry) => { setEditing(entry); setModalOpen(true) }
  const openNew = () => { setEditing(null); setModalOpen(true) }

  const monthCount = useMemo(() => {
    const now = new Date()
    return items.filter(e => {
      const d = e.date ? new Date(e.date) : e.createdAt ? new Date(e.createdAt.seconds * 1000) : null
      return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }).length
  }, [items])

  return (
    <div>
      <div className="module-header">
        <div>
          <h2 style={{ letterSpacing: '-0.02em' }}>{t('nav.journal')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {monthCount} записей в этом месяце
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Новая запись
        </button>
      </div>

      {/* Week mood strip */}
      <WeekMood items={items} />

      {/* Mood chart */}
      {items.length >= 3 && <MoodChart items={items} />}

      {/* Entry feed */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {[0,1,2].map(i => <div key={i} className="skeleton-pulse" style={{ height: 120 }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', marginTop: 16 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📔</div>
          <h3>Начни вести дневник</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Фиксируй мысли, настроение и события каждого дня</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openNew}>
            + Первая запись
          </button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 14, marginTop: 20 }}>
            Последние записи
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AnimatePresence>
              {items.map(entry => (
                <EntryCard key={entry.id} entry={entry} onDelete={remove} onEdit={openEdit} />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      <AnimatePresence>
        {modalOpen && (
          <EntryModal open={modalOpen} onClose={() => { setModalOpen(false); setEditing(null) }} entry={editing} onSave={save} />
        )}
      </AnimatePresence>
    </div>
  )
}
