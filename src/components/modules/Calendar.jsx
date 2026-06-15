import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, addWeeks, subWeeks, addDays, subDays,
  format, isSameMonth, isSameDay, isToday,
} from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import { toDate, toDateKey } from '../../utils/format'

const CATEGORIES = [
  { id: 'personal', color: '#5b4fcf' },
  { id: 'work', color: '#ff6b35' },
  { id: 'health', color: '#22c55e' },
  { id: 'social', color: '#f59e0b' },
]
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export default function Calendar() {
  const { items, add, update, remove } = useCollection('events', { orderField: 'date', direction: 'asc' })
  const tasks = useCollection('tasks')
  const reminders = useCollection('reminders', { orderField: 'date', direction: 'asc' })
  const { t } = useLang()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(new Date())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: '', date: toDateKey(), time: '', allDay: true, category: 'personal' })

  const eventsByDay = useMemo(() => {
    const map = {}
    const push = (key, item) => { (map[key] = map[key] || []).push(item) }
    items.forEach((e) => { const d = toDate(e.date); if (d) push(toDateKey(d), { ...e, _type: 'event' }) })
    tasks.items.forEach((tk) => { const d = toDate(tk.deadline); if (d) push(toDateKey(d), { id: tk.id, title: tk.title, color: '#9ca3af', _type: 'task' }) })
    reminders.items.forEach((r) => { const d = toDate(r.date); if (d) push(toDateKey(d), { id: r.id, title: r.title, color: '#7c6ff7', _type: 'reminder' }) })
    return map
  }, [items, tasks.items, reminders.items])

  useEffect(() => {
    if (params.get('new') === '1') { openNew(new Date()); params.delete('new'); setParams(params, { replace: true }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const openNew = (day) => {
    setEditing(null)
    setForm({ title: '', date: toDateKey(day), time: '', allDay: true, category: 'personal' })
    setModalOpen(true)
  }
  const openEdit = (ev) => {
    if (ev._type !== 'event') return
    setEditing(ev)
    const d = toDate(ev.date)
    setForm({ title: ev.title, date: toDateKey(d), time: ev.time || '', allDay: ev.allDay ?? !ev.time, category: ev.category || 'personal' })
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.title.trim()) return
    const color = CATEGORIES.find((c) => c.id === form.category)?.color || '#5b4fcf'
    const payload = { title: form.title.trim(), date: form.date, time: form.allDay ? '' : form.time, allDay: form.allDay, category: form.category, color }
    if (editing) await update(editing.id, payload)
    else await add(payload)
    toast.success(t('common.saved'))
    setModalOpen(false)
  }

  const navPrev = () => setCursor((c) => (view === 'month' ? subMonths(c, 1) : view === 'week' ? subWeeks(c, 1) : subDays(c, 1)))
  const navNext = () => setCursor((c) => (view === 'month' ? addMonths(c, 1) : view === 'week' ? addWeeks(c, 1) : addDays(c, 1)))

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [cursor])

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end: endOfWeek(cursor, { weekStartsOn: 1 }) })
  }, [cursor])

  const label = view === 'month' ? format(cursor, 'MMMM yyyy') : view === 'week'
    ? `${format(weekDays[0], 'd MMM')} – ${format(weekDays[6], 'd MMM')}`
    : format(cursor, 'EEEE, d MMM yyyy')

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-icon" onClick={navPrev}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg></button>
          <span className="date-label" style={{ minWidth: 180 }}>{label}</span>
          <button className="btn btn-ghost btn-icon" onClick={navNext}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg></button>
        </div>
        <div className="flex items-center gap-3">
          <div className="view-toggle">
            <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>{t('cal.month')}</button>
            <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>{t('cal.week')}</button>
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>{t('cal.day')}</button>
          </div>
          <button className="btn btn-primary" onClick={() => openNew(cursor)}>+ {t('cal.newEvent')}</button>
        </div>
      </div>

      {view === 'month' && (
        <div className="cal-grid">
          {WEEKDAYS.map((d) => <div key={d} className="cal-weekday">{d}</div>)}
          {monthDays.map((day) => {
            const key = toDateKey(day)
            const dayEvents = eventsByDay[key] || []
            return (
              <div key={key} className={`cal-cell ${isSameMonth(day, cursor) ? '' : 'other'} ${isToday(day) ? 'today' : ''}`} onClick={() => openNew(day)}>
                <span className="cal-daynum">{format(day, 'd')}</span>
                <div className="cal-dots">
                  {dayEvents.slice(0, 3).map((ev, i) => (
                    <div key={ev.id + i} className="cal-event cal-dot" style={{ background: ev.color }} title={ev.title} onClick={(e) => { e.stopPropagation(); openEdit(ev) }}>{ev.title}</div>
                  ))}
                  {dayEvents.length > 3 && <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>+{dayEvents.length - 3}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {view === 'week' && (
        <div className="cal-week-view">
          {weekDays.map((day) => {
            const key = toDateKey(day)
            const dayEvents = eventsByDay[key] || []
            return (
              <div key={key} className="card" style={isToday(day) ? { borderColor: 'var(--primary)' } : undefined}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
                  <strong>{format(day, 'EEEE, d MMM')}</strong>
                  <button className="btn btn-ghost" onClick={() => openNew(day)}>+</button>
                </div>
                {dayEvents.length ? dayEvents.map((ev, i) => (
                  <div key={ev.id + i} className="cal-event-row" onClick={() => openEdit(ev)} style={{ cursor: 'pointer', marginTop: 6 }}>
                    <span className="cal-cat-dot" style={{ background: ev.color }} />
                    <span style={{ flex: 1 }}>{ev.title}</span>
                    {ev.time && <span className="text-muted mono">{ev.time}</span>}
                  </div>
                )) : <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('cal.noEvents')}</p>}
              </div>
            )
          })}
        </div>
      )}

      {view === 'day' && (
        <div className="card cal-day-view">
          {(eventsByDay[toDateKey(cursor)] || []).length ? (
            eventsByDay[toDateKey(cursor)].map((ev, i) => (
              <div key={ev.id + i} className="cal-event-row" onClick={() => openEdit(ev)} style={{ cursor: 'pointer' }}>
                <span className="cal-cat-dot" style={{ background: ev.color }} />
                <span style={{ flex: 1 }}>{ev.title}</span>
                {ev.time && <span className="text-muted mono">{ev.time}</span>}
              </div>
            ))
          ) : <p className="text-muted">{t('cal.noEvents')}</p>}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('common.edit') : t('cal.newEvent')}>
        <div className="field">
          <label>{t('common.title')}</label>
          <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} autoFocus />
        </div>
        <div className="field">
          <label>{t('common.date')}</label>
          <input type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </div>
        <div className="settings-row" style={{ border: 'none', padding: 0 }}>
          <label>{t('cal.allDay')}</label>
          <button className={`toggle ${form.allDay ? 'on' : ''}`} onClick={() => setForm((f) => ({ ...f, allDay: !f.allDay }))}><span className="toggle-knob" /></button>
        </div>
        {!form.allDay && (
          <div className="field">
            <label>{t('cal.time')}</label>
            <input type="time" className="input" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
          </div>
        )}
        <div className="field">
          <label>{t('cal.category')}</label>
          <div className="flex gap-2">
            {CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => setForm((f) => ({ ...f, category: c.id }))} style={{ width: 32, height: 32, borderRadius: '50%', background: c.color, border: form.category === c.id ? '3px solid var(--text)' : '3px solid transparent' }} aria-label={c.id} />
            ))}
          </div>
        </div>
        <div className="flex justify-between gap-3">
          {editing ? <button className="btn btn-danger" onClick={async () => { await remove(editing.id); setModalOpen(false) }}>{t('common.delete')}</button> : <span />}
          <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
        </div>
      </Modal>
    </div>
  )
}
