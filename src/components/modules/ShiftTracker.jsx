import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths,
} from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import EmptyState from '../ui/EmptyState'
import { formatMoney, toDateKey, CURRENCIES } from '../../utils/format'

const SHIFT_TYPES = {
  day:    { emoji: '☀️',  color: '#22c55e', key: 'shift.day' },
  night:  { emoji: '🌙',  color: '#7c6ff7', key: 'shift.night' },
  off:    { emoji: '⚪',  color: '#9ca3af', key: 'shift.off' },
  custom: { emoji: '🟠',  color: '#ff6b35', key: 'shift.custom' },
}

const WELLBEING = ['😫', '😕', '😐', '🙂', '😄']

function hoursOf(s) {
  if (!s.startTime || !s.endTime || s.shiftType === 'off') return 0
  const [sh, sm] = s.startTime.split(':').map(Number)
  const [eh, em] = s.endTime.split(':').map(Number)
  let min = (eh * 60 + em) - (sh * 60 + sm)
  if (min < 0) min += 1440
  return min / 60
}

function earningsOf(s) {
  const r = parseFloat(s.rate) || 0
  if (!r || s.shiftType === 'off') return 0
  return s.rateType === 'fixed' ? r : hoursOf(s) * r
}

const BLANK = {
  date: toDateKey(), shiftType: 'day', startTime: '09:00', endTime: '18:00',
  workplace: '', rateType: 'hourly', rate: '', status: 'planned', wellbeing: null, note: '',
}

export default function ShiftTracker() {
  const { items, add, update, remove } = useCollection('shifts', { orderField: 'date', direction: 'desc' })
  const { t } = useLang()
  const toast = useToast()
  const [currency, setCurrency] = useLocalStorage('bullbir_currency', 'KGS')
  const [view, setView] = useState('calendar')
  const [month, setMonth] = useState(new Date())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(BLANK)
  const [wellbeingId, setWellbeingId] = useState(null)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const monthDays = useMemo(() => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }), [month])
  const byDate = useMemo(() => {
    const m = {}
    items.forEach((s) => { m[s.date] = s })
    return m
  }, [items])

  const activeShift = useMemo(() => items.find((s) => s.status === 'active'), [items])

  const timerStr = useMemo(() => {
    if (!activeShift?.activeStartedAt) return '00:00:00'
    const started = activeShift.activeStartedAt?.toDate?.() || new Date(activeShift.activeStartedAt)
    const diff = Math.max(0, Math.floor((now - started) / 1000))
    const h = Math.floor(diff / 3600)
    const m2 = Math.floor((diff % 3600) / 60)
    const s2 = diff % 60
    return `${String(h).padStart(2, '0')}:${String(m2).padStart(2, '0')}:${String(s2).padStart(2, '0')}`
  }, [activeShift, now])

  const stats = useMemo(() => {
    const monthKey = format(new Date(), 'yyyy-MM')
    const done = items.filter((s) => s.status === 'completed' && s.date?.startsWith(monthKey))
    return {
      hours: done.reduce((a, s) => a + hoursOf(s), 0),
      earned: done.reduce((a, s) => a + earningsOf(s), 0),
      count: done.length,
    }
  }, [items])

  const weekData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const key = toDateKey(d)
      const s = byDate[key]
      return { name: format(d, 'EEE'), hours: s ? hoursOf(s) : 0, earned: s ? earningsOf(s) : 0 }
    })
  }, [byDate])

  function openNew(date) {
    setForm({ ...BLANK, date: date || toDateKey() })
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(s) {
    setForm({
      date: s.date, shiftType: s.shiftType, startTime: s.startTime || '09:00',
      endTime: s.endTime || '18:00', workplace: s.workplace || '',
      rateType: s.rateType || 'hourly', rate: s.rate || '', status: s.status,
      wellbeing: s.wellbeing ?? null, note: s.note || '',
    })
    setEditingId(s.id)
    setModalOpen(true)
  }

  async function save() {
    const data = { ...form, rate: parseFloat(form.rate) || 0 }
    data.earnings = earningsOf(data)
    data.hours = hoursOf(data)
    if (editingId) await update(editingId, data)
    else await add(data)
    toast.success(t('common.saved'))
    setModalOpen(false)
  }

  async function startShift(s) {
    await update(s.id, { status: 'active', activeStartedAt: new Date() })
    toast.success(t('shift.started'))
  }

  async function endShift(s) {
    const started = s.activeStartedAt?.toDate?.() || new Date(s.activeStartedAt)
    const actualHours = (now - started) / 3600000
    const r = parseFloat(s.rate) || 0
    const earnings = s.rateType === 'fixed' ? r : actualHours * r
    await update(s.id, { status: 'completed', hours: Math.round(actualHours * 100) / 100, earnings: Math.round(earnings * 100) / 100 })
    setWellbeingId(s.id)
    toast.success(t('shift.completed'))
  }

  async function rateWellbeing(id, val) {
    await update(id, { wellbeing: val })
    setWellbeingId(null)
    toast.success(t('common.saved'))
  }

  const TEMPLATES = [
    { label: t('shift.day'),   type: 'day',   start: '09:00', end: '18:00' },
    { label: t('shift.night'), type: 'night', start: '21:00', end: '06:00' },
    { label: t('shift.off'),   type: 'off',   start: '00:00', end: '00:00' },
  ]

  const blankPad = (getDay(monthDays[0]) + 6) % 7

  return (
    <div>
      <div className="module-header">
        <div>
          <h2 style={{ letterSpacing: '-0.02em' }}>{t('shift.title')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {format(currentMonth, 'LLLL yyyy', { locale: undefined })} · {items.length} смен
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select className="select" style={{ width: 'auto' }} value={currency} onChange={e => setCurrency(e.target.value)}>
            {Object.keys(CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="tasks-tabs">
            <button className={`tasks-tab${view === 'calendar' ? ' active' : ''}`} onClick={() => setView('calendar')}>{t('shift.calendar')}</button>
            <button className={`tasks-tab${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>{t('common.all')}</button>
            <button className={`tasks-tab${view === 'stats' ? ' active' : ''}`} onClick={() => setView('stats')}>{t('shift.stats')}</button>
          </div>
          <button className="btn btn-primary" onClick={() => openNew()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            {t('shift.newShift')}
          </button>
        </div>
      </div>

      {/* Earnings hero card */}
      {items.length > 0 && (() => {
        const monthStart = startOfMonth(currentMonth)
        const monthEnd = endOfMonth(currentMonth)
        const monthItems = items.filter(s => {
          const d = s.date ? new Date(s.date) : null
          return d && d >= monthStart && d <= monthEnd && s.status !== 'off'
        })
        const totalEarnings = monthItems.reduce((a, s) => a + (s.earnings || 0), 0)
        const totalHours = monthItems.reduce((a, s) => a + (s.hours || 0), 0)
        return (
          <div className="shift-hero-card" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.8)', fontWeight: 500, position: 'relative' }}>
              Заработано в {format(currentMonth, 'LLLL', { locale: undefined })}
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', marginTop: 6, position: 'relative' }}>
              {formatMoney(totalEarnings, currency)}
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 18, position: 'relative' }}>
              <div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>Часов</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 2 }}>{Math.round(totalHours)} ч</div>
              </div>
              <div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>Смен</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 2 }}>{monthItems.length}</div>
              </div>
            </div>
            <div style={{ position: 'absolute', top: -30, right: -20, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
          </div>
        )
      })()}

      {/* Active shift banner */}
      <AnimatePresence>
        {activeShift && (
          <motion.div
            className="card shift-active-banner"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          >
            <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <span className="shift-active-pulse" />
                <strong>{t('shift.activeShift')}</strong>
                {activeShift.workplace && (
                  <p style={{ opacity: 0.8, fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>{activeShift.workplace}</p>
                )}
              </div>
              <div className="flex items-center gap-4">
                <span className="shift-timer">{timerStr}</span>
                <button className="btn" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }} onClick={() => endShift(activeShift)}>
                  {t('shift.endShift')}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Wellbeing rating modal */}
      <Modal open={!!wellbeingId} onClose={() => setWellbeingId(null)} title={t('shift.howWasShift')}>
        <p className="text-secondary" style={{ marginBottom: 'var(--space-5)', textAlign: 'center' }}>{t('shift.rateWellbeing')}</p>
        <div className="mood-big" style={{ justifyContent: 'center' }}>
          {WELLBEING.map((e, i) => (
            <motion.button key={i} className="mood-big-pill" whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.95 }}
              onClick={() => rateWellbeing(wellbeingId, i + 1)}>{e}
            </motion.button>
          ))}
        </div>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 'var(--space-4)' }} onClick={() => setWellbeingId(null)}>{t('common.skip')}</button>
      </Modal>

      {/* CALENDAR VIEW */}
      {view === 'calendar' && (
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
            <button className="btn btn-ghost" onClick={() => setMonth(subMonths(month, 1))}>←</button>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>{format(month, 'MMMM yyyy')}</h2>
            <button className="btn btn-ghost" onClick={() => setMonth(addMonths(month, 1))}>→</button>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="shift-cal-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="cal-weekday">{d}</div>
              ))}
              {Array.from({ length: blankPad }).map((_, i) => <div key={`b${i}`} className="shift-cal-cell empty" />)}
              {monthDays.map((day) => {
                const key = toDateKey(day)
                const shift = byDate[key]
                const isToday = key === toDateKey()
                return (
                  <div key={key} className={`shift-cal-cell${isToday ? ' today' : ''}`} onClick={() => shift ? openEdit(shift) : openNew(key)}>
                    {isToday
                      ? <span className="today-num">{day.getDate()}</span>
                      : <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>{day.getDate()}</span>
                    }
                    {shift && (
                      <span className="shift-dot" title={t(SHIFT_TYPES[shift.shiftType]?.key || 'shift.day')}
                        style={{ color: SHIFT_TYPES[shift.shiftType]?.color }}>
                        {SHIFT_TYPES[shift.shiftType]?.emoji}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex gap-4" style={{ marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
            {Object.entries(SHIFT_TYPES).map(([key, { emoji, color, key: labelKey }]) => (
              <span key={key} className="flex items-center gap-1" style={{ fontSize: 'var(--text-sm)' }}>
                <span style={{ color }}>{emoji}</span> {t(labelKey)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* LIST VIEW */}
      {view === 'list' && (
        items.length === 0
          ? <EmptyState message={t('shift.noShifts')} action={<button className="btn btn-primary" onClick={() => openNew()}>+ {t('shift.newShift')}</button>} />
          : (
            <div className="list-stack">
              <AnimatePresence>
                {items.map((s) => {
                  const st = SHIFT_TYPES[s.shiftType] || SHIFT_TYPES.day
                  return (
                    <motion.div key={s.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                      className="shift-row" onClick={() => openEdit(s)}>
                      <span className="shift-row-type" style={{ background: `${st.color}22`, color: st.color }}>
                        {st.emoji} {t(st.key)}
                      </span>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: 'var(--text-sm)' }}>{s.date}</strong>
                        {s.workplace && <span className="text-secondary" style={{ marginLeft: 8, fontSize: 'var(--text-sm)' }}>{s.workplace}</span>}
                        <div className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 2 }}>
                          {s.shiftType !== 'off' && `${s.startTime} – ${s.endTime}`}
                          {s.wellbeing != null && <span style={{ marginLeft: 8 }}>{WELLBEING[s.wellbeing - 1]}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {s.status === 'completed' && earningsOf(s) > 0 && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--success)', fontSize: 'var(--text-sm)' }}>
                            +{formatMoney(earningsOf(s), currency)}
                          </div>
                        )}
                        {s.status === 'planned' && (
                          <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 'var(--text-xs)' }}
                            onClick={(e) => { e.stopPropagation(); startShift(s) }}>
                            {t('shift.startShift')}
                          </button>
                        )}
                        <span className={`shift-status shift-status-${s.status}`}>{t(`shift.${s.status}`)}</span>
                      </div>
                      <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); remove(s.id) }}>×</button>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )
      )}

      {/* STATS VIEW */}
      {view === 'stats' && (
        <div>
          <div className="fin-stats" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="card fin-stat">
              <span className="text-secondary">{t('shift.hoursThisMonth')}</span>
              <span className="amount" style={{ color: 'var(--primary)' }}>{stats.hours.toFixed(1)}h</span>
            </div>
            <div className="card fin-stat income">
              <span className="text-secondary">{t('shift.earnedThisMonth')}</span>
              <span className="amount">{formatMoney(stats.earned, currency)}</span>
            </div>
            <div className="card fin-stat">
              <span className="text-secondary">{t('shift.shiftsThisMonth')}</span>
              <span className="amount" style={{ color: 'var(--accent)' }}>{stats.count}</span>
            </div>
          </div>

          {weekData.some((d) => d.hours > 0) ? (
            <div className="grid grid-2" style={{ marginBottom: 'var(--space-5)' }}>
              <div className="card">
                <span className="section-title">{t('shift.hoursPerDay')}</span>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weekData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="name" fontSize={11} stroke="var(--text-muted)" />
                      <YAxis fontSize={11} stroke="var(--text-muted)" />
                      <Tooltip />
                      <Bar dataKey="hours" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="card">
                <span className="section-title">{t('shift.earningsPerDay')}</span>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weekData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="name" fontSize={11} stroke="var(--text-muted)" />
                      <YAxis fontSize={11} stroke="var(--text-muted)" />
                      <Tooltip formatter={(v) => formatMoney(v, currency)} />
                      <Bar dataKey="earned" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message={t('shift.noShifts')} action={<button className="btn btn-primary" onClick={() => openNew()}>+ {t('shift.newShift')}</button>} />
          )}
        </div>
      )}

      {/* ADD / EDIT MODAL */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? t('common.edit') : t('shift.newShift')}>
        {/* Quick templates */}
        <div className="flex gap-2" style={{ marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          {TEMPLATES.map((tpl) => (
            <button key={tpl.type} className="btn btn-secondary" style={{ fontSize: 'var(--text-sm)', padding: '6px 12px' }}
              onClick={() => setForm((f) => ({ ...f, shiftType: tpl.type, startTime: tpl.start, endTime: tpl.end }))}>
              {SHIFT_TYPES[tpl.type].emoji} {tpl.label}
            </button>
          ))}
        </div>

        <div className="field">
          <label>{t('common.date')}</label>
          <input type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </div>

        <div className="field">
          <label>{t('shift.type')}</label>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {Object.entries(SHIFT_TYPES).map(([type, { emoji, key: lk }]) => (
              <button key={type} className={`mood-pill ${form.shiftType === type ? 'selected' : ''}`}
                onClick={() => setForm((f) => ({ ...f, shiftType: type }))}>
                <span style={{ fontSize: 20 }}>{emoji}</span>
                <span className="mood-label">{t(lk)}</span>
              </button>
            ))}
          </div>
        </div>

        {form.shiftType !== 'off' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div className="field">
              <label>{t('shift.startTime')}</label>
              <input type="time" className="input" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
            </div>
            <div className="field">
              <label>{t('shift.endTime')}</label>
              <input type="time" className="input" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
            </div>
          </div>
        )}

        <div className="field">
          <label>{t('shift.workplace')} <span className="text-muted">({t('common.optional')})</span></label>
          <input className="input" value={form.workplace} placeholder={t('shift.workplacePlaceholder')}
            onChange={(e) => setForm((f) => ({ ...f, workplace: e.target.value }))} />
        </div>

        {form.shiftType !== 'off' && (
          <>
            <div className="field">
              <label>{t('shift.rateType')}</label>
              <div className="view-toggle">
                <button className={form.rateType === 'hourly' ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, rateType: 'hourly' }))}>{t('shift.hourly')}</button>
                <button className={form.rateType === 'fixed' ? 'active' : ''} onClick={() => setForm((f) => ({ ...f, rateType: 'fixed' }))}>{t('shift.fixed')}</button>
              </div>
            </div>
            <div className="field">
              <label>{t('shift.rate')} ({form.rateType === 'hourly' ? `${currency}/h` : currency}) <span className="text-muted">({t('common.optional')})</span></label>
              <input type="number" className="input" value={form.rate} placeholder="0"
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            </div>
          </>
        )}

        <div className="field">
          <label>{t('common.description')} <span className="text-muted">({t('common.optional')})</span></label>
          <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </div>

        {editingId && form.status === 'completed' && (
          <div className="field">
            <label>{t('shift.wellbeing')}</label>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {WELLBEING.map((e, i) => (
                <button key={i} className={`mood-pill ${form.wellbeing === i + 1 ? 'selected' : ''}`}
                  style={{ fontSize: 22, minWidth: 48 }} onClick={() => setForm((f) => ({ ...f, wellbeing: i + 1 }))}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3" style={{ marginTop: 'var(--space-4)' }}>
          <button className="btn btn-primary btn-block" onClick={save}>{t('common.save')}</button>
          {editingId && (
            <button className="btn btn-danger" onClick={async () => { await remove(editingId); setModalOpen(false) }}>
              {t('common.delete')}
            </button>
          )}
        </div>
      </Modal>
    </div>
  )
}
