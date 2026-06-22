import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { differenceInDays, parseISO } from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import EmptyState from '../ui/EmptyState'
import { formatMoney, toDateKey, CURRENCIES } from '../../utils/format'

const EMOJIS = ['🎯', '📱', '✈️', '🚗', '🏠', '💻', '🎸', '📚', '👟', '💍', '🐾', '🌴', '🏋️', '🎮', '💎', '🛍️', '🍕', '🎓', '🚀', '❤️', '🌟', '⚡', '🌊', '🏆']

function ProgressRing({ pct, size = 80, stroke = 9 }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(100, pct) / 100)
  const color = pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--accent)' : 'var(--primary)'
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-secondary)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
        style={{ strokeDasharray: circ }}
      />
    </svg>
  )
}

function Confetti() {
  const colors = ['#5b4fcf', '#ff6b35', '#22c55e', '#f59e0b', '#7c6ff7', '#ef4444', '#fff']
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1300, overflow: 'hidden' }}>
      {Array.from({ length: 60 }).map((_, i) => {
        const x = Math.random() * 100
        const delay = Math.random() * 0.5
        const dur = 1.2 + Math.random() * 1
        const color = colors[i % colors.length]
        const size = 6 + Math.random() * 8
        return (
          <motion.div key={i}
            style={{
              position: 'absolute', top: '-10px', left: `${x}%`,
              width: size, height: size, borderRadius: Math.random() > 0.5 ? '50%' : 2,
              background: color,
            }}
            initial={{ y: 0, opacity: 1, rotate: 0, x: 0 }}
            animate={{ y: '100vh', opacity: 0, rotate: 360 * (Math.random() > 0.5 ? 1 : -1), x: (Math.random() - 0.5) * 200 }}
            transition={{ delay, duration: dur, ease: 'easeIn' }}
          />
        )
      })}
    </div>
  )
}

const BLANK_GOAL = { name: '', emoji: '🎯', targetAmount: '', currentAmount: '', currency: 'KGS', deadline: '', note: '' }
const BLANK_CONTRIB = { amount: '', note: '' }

export default function SavingsGoals() {
  const { items, add, update, remove } = useCollection('savingsGoals', { orderField: 'createdAt', direction: 'asc' })
  const { t } = useLang()
  const toast = useToast()
  const [defaultCurrency] = useLocalStorage('bullbir_currency', 'KGS')
  const [goalModal, setGoalModal] = useState(false)
  const [contribModal, setContribModal] = useState(null) // goal id
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ ...BLANK_GOAL, currency: defaultCurrency })
  const [contrib, setContrib] = useState(BLANK_CONTRIB)
  const [showArchived, setShowArchived] = useState(false)
  const [confetti, setConfetti] = useState(false)
  const confettiTimer = useRef(null)

  useEffect(() => () => clearTimeout(confettiTimer.current), [])

  const { active, completed: archived } = useMemo(() => {
    const active = [], completed = []
    items.forEach((g) => (g.completed ? completed : active).push(g))
    return { active, completed }
  }, [items])

  const totalSaved = useMemo(() => active.reduce((a, g) => a + (parseFloat(g.currentAmount) || 0), 0), [active])

  function openNew() {
    setForm({ ...BLANK_GOAL, currency: defaultCurrency })
    setEditingId(null)
    setGoalModal(true)
  }

  function openEdit(g) {
    setForm({ name: g.name, emoji: g.emoji || '🎯', targetAmount: g.targetAmount, currentAmount: g.currentAmount, currency: g.currency || defaultCurrency, deadline: g.deadline || '', note: g.note || '' })
    setEditingId(g.id)
    setGoalModal(true)
  }

  async function saveGoal() {
    if (!form.name.trim() || !form.targetAmount) return
    const data = { ...form, targetAmount: parseFloat(form.targetAmount) || 0, currentAmount: parseFloat(form.currentAmount) || 0, completed: false }
    if (editingId) await update(editingId, data)
    else await add(data)
    toast.success(t('common.saved'))
    setGoalModal(false)
  }

  async function contribute() {
    const amount = parseFloat(contrib.amount)
    if (!amount || amount <= 0) return
    const goal = items.find((g) => g.id === contribModal)
    if (!goal) return
    const newAmount = (parseFloat(goal.currentAmount) || 0) + amount
    const target = parseFloat(goal.targetAmount) || 1
    const wasCompleted = goal.completed
    const nowCompleted = newAmount >= target
    await update(contribModal, { currentAmount: newAmount, completed: nowCompleted })
    toast.success(t('sav.contributed'))
    setContribModal(null)
    setContrib(BLANK_CONTRIB)
    if (nowCompleted && !wasCompleted) {
      setConfetti(true)
      confettiTimer.current = setTimeout(() => setConfetti(false), 2500)
    }
  }

  async function deleteGoal(id) {
    await remove(id)
    toast.success(t('common.deleted') || t('common.done'))
    setGoalModal(false)
  }

  function deadlineInfo(g) {
    if (!g.deadline) return null
    const days = differenceInDays(parseISO(g.deadline), new Date())
    if (days < 0) return { label: t('sav.overdue'), cls: 'overdue' }
    const pct = Math.round(((parseFloat(g.currentAmount) || 0) / Math.max(1, parseFloat(g.targetAmount))) * 100)
    const months = days / 30
    const monthlyNeeded = months > 0 ? ((parseFloat(g.targetAmount) - (parseFloat(g.currentAmount) || 0)) / months).toFixed(0) : 0
    const target = parseFloat(g.targetAmount) || 1
    const current = parseFloat(g.currentAmount) || 0
    const expectedPct = Math.round((1 - days / differenceInDays(parseISO(g.deadline), new Date(g.createdAt?.toDate?.() || g.createdAt || 0))) * 100)
    const cls = pct >= Math.max(0, expectedPct - 10) ? 'ontrack' : 'behindSchedule'
    return { label: `${days} ${t('sav.daysLeft')}`, cls, monthlyNeeded, currency: g.currency || defaultCurrency }
  }

  const LIST_ITEM = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, scale: 0.95 }, transition: { type: 'spring', stiffness: 280, damping: 26 } }

  return (
    <div>
      {confetti && <Confetti />}

      <div className="page-header">
        <h1>{t('sav.title')}</h1>
        <button className="btn btn-primary" onClick={openNew}>+ {t('sav.newGoal')}</button>
      </div>

      {/* Stats bar */}
      <div className="sav-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card sav-stat">
          <div className="sav-stat-value" style={{ color: 'var(--success)' }}>{formatMoney(totalSaved, defaultCurrency)}</div>
          <div className="sav-stat-label">{t('sav.totalSaved')}</div>
        </div>
        <div className="card sav-stat">
          <div className="sav-stat-value" style={{ color: 'var(--primary)' }}>{active.length}</div>
          <div className="sav-stat-label">{t('sav.totalGoals')}</div>
        </div>
        <div className="card sav-stat">
          <div className="sav-stat-value" style={{ color: 'var(--accent)' }}>{archived.length}</div>
          <div className="sav-stat-label">{t('sav.goalsCompleted')}</div>
        </div>
      </div>

      {/* Active goals */}
      {active.length === 0 ? (
        <EmptyState message={t('sav.noGoals')} action={<button className="btn btn-primary" onClick={openNew}>+ {t('sav.newGoal')}</button>} />
      ) : (
        <div className="sav-grid">
          <AnimatePresence>
            {active.map((g) => {
              const pct = Math.min(100, Math.round(((parseFloat(g.currentAmount) || 0) / Math.max(1, parseFloat(g.targetAmount))) * 100))
              const dl = deadlineInfo(g)
              const cur = g.currency || defaultCurrency
              return (
                <motion.div key={g.id} {...LIST_ITEM} className="card sav-card">
                  <div className="sav-card-head">
                    <div className="sav-emoji">{g.emoji || '🎯'}</div>
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: 'var(--text-md)' }}>{g.name}</strong>
                      {dl && <div className={`sav-deadline ${dl.cls}`}>{dl.label}</div>}
                    </div>
                    <div className="sav-ring">
                      <ProgressRing pct={pct} size={72} stroke={8} />
                      <div className="sav-ring-label">
                        <span className="sav-ring-pct">{pct}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="sav-amounts">
                    <div>
                      <div className="sav-amount-current">{formatMoney(parseFloat(g.currentAmount) || 0, cur)}</div>
                      <div className="sav-amount-target">of {formatMoney(parseFloat(g.targetAmount) || 0, cur)}</div>
                    </div>
                    {dl?.monthlyNeeded > 0 && (
                      <div style={{ textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        <div style={{ fontWeight: 700 }}>{formatMoney(dl.monthlyNeeded, cur)}</div>
                        <div>{t('sav.monthlyNeeded')}</div>
                      </div>
                    )}
                  </div>

                  <div className="progress-bar">
                    <motion.div className="progress-fill" initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                      style={{ background: pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--accent)' : 'var(--gradient-primary)' }}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setContribModal(g.id)}>
                      + {t('sav.contribute')}
                    </button>
                    <button className="btn btn-ghost btn-icon" onClick={() => openEdit(g)} title={t('common.edit')}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
                      </svg>
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Archived goals */}
      {archived.length > 0 && (
        <div style={{ marginTop: 'var(--space-6)' }}>
          <button className="btn btn-ghost" style={{ marginBottom: 'var(--space-3)' }} onClick={() => setShowArchived((v) => !v)}>
            🏆 {t('sav.archived')} ({archived.length}) {showArchived ? '▲' : '▼'}
          </button>
          <AnimatePresence>
            {showArchived && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="sav-grid">
                {archived.map((g) => {
                  const cur = g.currency || defaultCurrency
                  return (
                    <div key={g.id} className="card sav-card" style={{ opacity: 0.75 }}>
                      <div className="sav-completed-tag">✓ {t('sav.completed')}</div>
                      <div className="sav-card-head">
                        <div className="sav-emoji">{g.emoji || '🏆'}</div>
                        <div style={{ flex: 1 }}>
                          <strong>{g.name}</strong>
                          <div className="sav-deadline ontrack">{formatMoney(parseFloat(g.targetAmount) || 0, cur)}</div>
                        </div>
                      </div>
                      <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)' }} onClick={() => remove(g.id)}>{t('common.delete')}</button>
                    </div>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Contribute modal */}
      <Modal open={!!contribModal} onClose={() => setContribModal(null)} title={t('sav.contribute')}>
        {contribModal && (() => {
          const g = items.find((x) => x.id === contribModal)
          if (!g) return null
          const cur = g.currency || defaultCurrency
          const current = parseFloat(g.currentAmount) || 0
          const target = parseFloat(g.targetAmount) || 0
          return (
            <>
              <div style={{ textAlign: 'center', marginBottom: 'var(--space-4)' }}>
                <div style={{ fontSize: 40 }}>{g.emoji || '🎯'}</div>
                <strong>{g.name}</strong>
                <p className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
                  {formatMoney(current, cur)} / {formatMoney(target, cur)}
                </p>
              </div>
              <div className="field">
                <label>{t('sav.addAmount')}</label>
                <input type="number" className="input" autoFocus value={contrib.amount} placeholder="0"
                  onChange={(e) => setContrib((c) => ({ ...c, amount: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('common.description')} <span className="text-muted">({t('common.optional')})</span></label>
                <input className="input" value={contrib.note} onChange={(e) => setContrib((c) => ({ ...c, note: e.target.value }))} />
              </div>
              <button className="btn btn-primary btn-block" onClick={contribute}>{t('sav.contribute')}</button>
            </>
          )
        })()}
      </Modal>

      {/* Add / Edit goal modal */}
      <Modal open={goalModal} onClose={() => setGoalModal(false)} title={editingId ? t('common.edit') : t('sav.newGoal')}>
        <div className="field">
          <label>{t('sav.goalName')}</label>
          <input className="input" autoFocus value={form.name} placeholder={t('sav.goalNamePlaceholder')}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>

        <div className="field">
          <label>{t('sav.emoji')}</label>
          <div className="emoji-grid">
            {EMOJIS.map((e) => (
              <button key={e} className={`emoji-btn ${form.emoji === e ? 'selected' : ''}`} onClick={() => setForm((f) => ({ ...f, emoji: e }))}>{e}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="field">
            <label>{t('sav.targetAmount')}</label>
            <input type="number" className="input" value={form.targetAmount} placeholder="0"
              onChange={(e) => setForm((f) => ({ ...f, targetAmount: e.target.value }))} />
          </div>
          <div className="field">
            <label>{t('sav.currentAmount')}</label>
            <input type="number" className="input" value={form.currentAmount} placeholder="0"
              onChange={(e) => setForm((f) => ({ ...f, currentAmount: e.target.value }))} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="field">
            <label>{t('fin.currency')}</label>
            <select className="select" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
              {Object.keys(CURRENCIES).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>{t('sav.deadline')} <span className="text-muted">({t('common.optional')})</span></label>
            <input type="date" className="input" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
          </div>
        </div>

        <div className="field">
          <label>{t('sav.note')} <span className="text-muted">({t('common.optional')})</span></label>
          <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </div>

        <div className="flex gap-3" style={{ marginTop: 'var(--space-4)' }}>
          <button className="btn btn-primary btn-block" onClick={saveGoal}>{t('common.save')}</button>
          {editingId && (
            <button className="btn btn-danger" onClick={() => deleteGoal(editingId)}>{t('common.delete')}</button>
          )}
        </div>
      </Modal>
    </div>
  )
}
