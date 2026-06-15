import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import EmptyState from '../ui/EmptyState'
import { toDate, toDateKey } from '../../utils/format'

export default function Reminders() {
  const { items, add, update, remove } = useCollection('reminders', { orderField: 'date', direction: 'asc' })
  const { t } = useLang()
  const toast = useToast()
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ title: '', date: toDateKey(), time: '09:00' })
  const firedRef = useRef(new Set())

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') { toast.error(t('rem.denied')); return }
    const res = await Notification.requestPermission()
    setPermission(res)
    if (res === 'granted') toast.success(t('rem.enabled'))
    else toast.error(t('rem.denied'))
  }

  // Check reminders every 30s and fire due notifications.
  useEffect(() => {
    if (permission !== 'granted') return undefined
    const tick = () => {
      const now = new Date()
      items.forEach((r) => {
        if (r.done || firedRef.current.has(r.id)) return
        const d = toDate(r.date)
        if (!d) return
        const [h, m] = (r.time || '09:00').split(':').map(Number)
        d.setHours(h, m, 0, 0)
        if (now >= d && now - d < 60000) {
          firedRef.current.add(r.id)
          new Notification('BullBir', { body: r.title, icon: '/icons/icon-192.png' })
        }
      })
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [items, permission])

  const save = async () => {
    if (!form.title.trim()) return
    await add({ title: form.title.trim(), date: form.date, time: form.time, done: false })
    toast.success(t('common.saved'))
    setForm({ title: '', date: toDateKey(), time: '09:00' })
    setModalOpen(false)
  }

  return (
    <div>
      <div className="page-header">
        <h1>{t('rem.title')}</h1>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ {t('rem.new')}</button>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="settings-row" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            <strong>{t('set.notifications')}</strong>
            <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('rem.digest')}</p>
          </div>
          {permission === 'granted' ? (
            <span className="badge" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--success)' }}>{t('rem.enabled')}</span>
          ) : (
            <button className="btn btn-secondary" onClick={requestPermission}>{t('rem.enable')}</button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState message={t('rem.empty')} action={<button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ {t('rem.new')}</button>} />
      ) : (
        <div className="list-stack">
          <AnimatePresence>
            {items.map((r) => (
              <motion.div key={r.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="rem-row">
                <button className={`checkbox ${r.done ? 'checked' : ''}`} onClick={() => update(r.id, { done: !r.done })}>
                  {r.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>}
                </button>
                <div style={{ flex: 1 }}>
                  <span style={{ textDecoration: r.done ? 'line-through' : 'none', color: r.done ? 'var(--text-muted)' : 'var(--text)' }}>{r.title}</span>
                  <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{toDate(r.date) ? format(toDate(r.date), 'd MMM') : ''}</div>
                </div>
                <span className="rem-time">{r.time}</span>
                <button className="btn btn-ghost btn-icon" onClick={() => remove(r.id)}>×</button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('rem.new')}>
        <div className="field">
          <label>{t('common.title')}</label>
          <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} autoFocus />
        </div>
        <div className="grid grid-2" style={{ gap: 'var(--space-3)' }}>
          <div className="field">
            <label>{t('common.date')}</label>
            <input type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="field">
            <label>{t('rem.at')}</label>
            <input type="time" className="input" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
          </div>
        </div>
        <button className="btn btn-primary btn-block" onClick={save}>{t('common.save')}</button>
      </Modal>
    </div>
  )
}
