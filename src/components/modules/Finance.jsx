import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { format } from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import EmptyState from '../ui/EmptyState'
import { formatMoney, toDate, toDateKey, CURRENCIES } from '../../utils/format'

const CATEGORIES = {
  income: [
    { id: 'salary', emoji: '💼' },
    { id: 'gift', emoji: '🎁' },
    { id: 'other', emoji: '💰' },
  ],
  expense: [
    { id: 'food', emoji: '🍔' },
    { id: 'transport', emoji: '🚌' },
    { id: 'shopping', emoji: '🛍️' },
    { id: 'bills', emoji: '🧾' },
    { id: 'fun', emoji: '🎉' },
    { id: 'health', emoji: '💊' },
    { id: 'other', emoji: '📦' },
  ],
}
const PIE_COLORS = ['#5b4fcf', '#ff6b35', '#22c55e', '#f59e0b', '#7c6ff7', '#ff9a6c', '#ef4444']

function catEmoji(type, id) {
  return [...CATEGORIES.income, ...CATEGORIES.expense].find((c) => c.id === id)?.emoji || '📦'
}

export default function Finance() {
  const { items, add, remove } = useCollection('transactions', { orderField: 'date', direction: 'desc' })
  const { t } = useLang()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [currency, setCurrency] = useLocalStorage('bullbir_currency', 'KGS')
  const [budget, setBudget] = useLocalStorage('bullbir_budget', 0)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ type: 'expense', amount: '', category: 'food', note: '', date: toDateKey() })

  useEffect(() => {
    if (params.get('new') === '1') { setModalOpen(true); params.delete('new'); setParams(params, { replace: true }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const income = useMemo(() => items.filter((x) => x.type === 'income').reduce((a, x) => a + x.amount, 0), [items])
  const expense = useMemo(() => items.filter((x) => x.type === 'expense').reduce((a, x) => a + x.amount, 0), [items])
  const balance = income - expense

  const byCategory = useMemo(() => {
    const map = {}
    items.filter((x) => x.type === 'expense').forEach((x) => { map[x.category] = (map[x.category] || 0) + x.amount })
    return Object.entries(map).map(([name, value]) => ({ name, value }))
  }, [items])

  const overTime = useMemo(() => {
    const map = {}
    items.forEach((x) => {
      const d = toDate(x.date)
      if (!d) return
      const key = format(d, 'MMM d')
      map[key] = map[key] || { name: key, income: 0, expense: 0 }
      map[key][x.type] += x.amount
    })
    return Object.values(map).slice(-14)
  }, [items])

  const save = async () => {
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) return
    await add({ type: form.type, amount, category: form.category, note: form.note.trim(), date: form.date, currency })
    toast.success(t('common.saved'))
    setModalOpen(false)
    setForm({ type: 'expense', amount: '', category: 'food', note: '', date: toDateKey() })
  }

  const exportCSV = () => {
    const rows = [['date', 'type', 'category', 'amount', 'currency', 'note']]
    items.forEach((x) => {
      const d = toDate(x.date)
      rows.push([d ? toDateKey(d) : '', x.type, x.category, x.amount, x.currency || currency, x.note || ''])
    })
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bullbir-finance-${toDateKey()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const budgetPct = budget > 0 ? Math.min(100, (expense / budget) * 100) : 0

  return (
    <div>
      <div className="page-header">
        <h1>{t('fin.title')}</h1>
        <div className="flex gap-3 items-center">
          <select className="select" style={{ width: 'auto' }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {Object.keys(CURRENCIES).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={exportCSV}>{t('fin.export')}</button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ {t('fin.newTxn')}</button>
        </div>
      </div>

      <div className="fin-stats" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card fin-stat income"><span className="text-secondary">{t('fin.income')}</span><span className="amount">{formatMoney(income, currency)}</span></div>
        <div className="card fin-stat expense"><span className="text-secondary">{t('fin.expense')}</span><span className="amount">{formatMoney(expense, currency)}</span></div>
        <div className="card fin-stat"><span className="text-secondary">{t('fin.balance')}</span><span className="amount" style={{ color: balance >= 0 ? 'var(--success)' : 'var(--error)' }}>{formatMoney(balance, currency)}</span></div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
          <span className="section-title" style={{ margin: 0 }}>{t('fin.budget')}</span>
          <input type="number" className="input" style={{ width: 140 }} value={budget || ''} placeholder="0" onChange={(e) => setBudget(parseFloat(e.target.value) || 0)} />
        </div>
        {budget > 0 && (
          <>
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${budgetPct}%`, background: budgetPct >= 100 ? 'var(--error)' : 'var(--gradient-primary)' }} /></div>
            <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 6 }}>{formatMoney(expense, currency)} / {formatMoney(budget, currency)}</p>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState message={t('fin.empty')} action={<button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ {t('fin.newTxn')}</button>} />
      ) : (
        <>
          <div className="grid grid-2" style={{ marginBottom: 'var(--space-5)' }}>
            <div className="card">
              <span className="section-title">{t('fin.byCategory')}</span>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50}>
                      {byCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatMoney(v, currency)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <span className="section-title">{t('fin.overTime')}</span>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={overTime}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="name" fontSize={11} stroke="var(--text-muted)" />
                    <YAxis fontSize={11} stroke="var(--text-muted)" width={40} />
                    <Tooltip formatter={(v) => formatMoney(v, currency)} />
                    <Line type="monotone" dataKey="income" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="list-stack">
            <AnimatePresence>
              {items.map((x) => (
                <motion.div key={x.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="txn-row">
                  <span className="txn-cat">{catEmoji(x.type, x.category)}</span>
                  <div style={{ flex: 1 }}>
                    <strong>{t(`fin.category`)}: {x.category}</strong>
                    <div className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{x.note} · {toDate(x.date) ? format(toDate(x.date), 'd MMM') : ''}</div>
                  </div>
                  <span className={`txn-amt ${x.type}`}>{x.type === 'income' ? '+' : '−'}{formatMoney(x.amount, x.currency || currency)}</span>
                  <button className="btn btn-ghost btn-icon" onClick={() => remove(x.id)} aria-label={t('common.delete')}>×</button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('fin.newTxn')}>
        <div className="view-toggle" style={{ width: '100%' }}>
          <button className={form.type === 'expense' ? 'active' : ''} style={{ flex: 1 }} onClick={() => setForm((f) => ({ ...f, type: 'expense', category: CATEGORIES.expense[0].id }))}>{t('fin.expense')}</button>
          <button className={form.type === 'income' ? 'active' : ''} style={{ flex: 1 }} onClick={() => setForm((f) => ({ ...f, type: 'income', category: CATEGORIES.income[0].id }))}>{t('fin.income')}</button>
        </div>
        <div className="field">
          <label>{t('fin.amount')}</label>
          <input type="number" className="input" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} autoFocus placeholder="0" />
        </div>
        <div className="field">
          <label>{t('fin.category')}</label>
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {CATEGORIES[form.type].map((c) => (
              <button key={c.id} className={`mood-pill ${form.category === c.id ? 'selected' : ''}`} style={{ fontSize: 20 }} onClick={() => setForm((f) => ({ ...f, category: c.id }))}>
                {c.emoji}<span className="mood-label">{c.id}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('common.date')}</label>
          <input type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </div>
        <div className="field">
          <label>{t('common.description')} <span className="text-muted">({t('common.optional')})</span></label>
          <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </div>
        <button className="btn btn-primary btn-block" onClick={save}>{t('common.save')}</button>
      </Modal>
    </div>
  )
}
