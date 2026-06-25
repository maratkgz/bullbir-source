import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { format } from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import { formatMoney, toDate, toDateKey, CURRENCIES } from '../../utils/format'

const CATEGORIES = {
  income: [
    { id: 'salary',  emoji: '💼' },
    { id: 'gift',    emoji: '🎁' },
    { id: 'other',   emoji: '💰' },
  ],
  expense: [
    { id: 'food',       emoji: '🍔' },
    { id: 'transport',  emoji: '🚕' },
    { id: 'shopping',   emoji: '🛍️' },
    { id: 'bills',      emoji: '🧾' },
    { id: 'fun',        emoji: '🎬' },
    { id: 'health',     emoji: '💊' },
    { id: 'other',      emoji: '📦' },
  ],
}

const CAT_COLORS = ['#7c5cff', '#5ad1a5', '#f0a45a', '#e06a9a', '#9a8cff', '#f0c45a', '#7a7a8c']

function catEmoji(type, id) {
  return [...CATEGORIES.income, ...CATEGORIES.expense].find(c => c.id === id)?.emoji || '📦'
}

function catLabel(t, id) {
  const map = {
    salary: t('fin.salary') || 'Зарплата',
    gift: t('fin.gift') || 'Подарок',
    food: t('fin.food') || 'Еда',
    transport: t('fin.transport') || 'Транспорт',
    shopping: t('fin.shopping') || 'Покупки',
    bills: t('fin.bills') || 'Счета',
    fun: t('fin.fun') || 'Развлечения',
    health: t('fin.health') || 'Здоровье',
    other: t('fin.other') || 'Другое',
  }
  return map[id] || id
}

export default function Finance() {
  const { items, add, remove } = useCollection('transactions', { orderField: 'date', direction: 'desc' })
  const { t, lang } = useLang()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [currency, setCurrency] = useLocalStorage('bullbir_currency', 'KGS')
  const [budget, setBudget] = useLocalStorage('bullbir_budget', 0)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ type: 'expense', amount: '', category: 'food', note: '', date: toDateKey() })

  useEffect(() => {
    if (params.get('new') === '1') { setModalOpen(true); params.delete('new'); setParams(params, { replace: true }) }
  }, [params, setParams])

  const income = useMemo(() => items.filter(x => x.type === 'income').reduce((a, x) => a + x.amount, 0), [items])
  const expense = useMemo(() => items.filter(x => x.type === 'expense').reduce((a, x) => a + x.amount, 0), [items])
  const balance = income - expense

  const byCategory = useMemo(() => {
    const map = {}
    items.filter(x => x.type === 'expense').forEach(x => { map[x.category] = (map[x.category] || 0) + x.amount })
    return Object.entries(map)
      .map(([id, value]) => ({ id, value }))
      .sort((a, b) => b.value - a.value)
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
    items.forEach(x => {
      const d = toDate(x.date)
      rows.push([d ? toDateKey(d) : '', x.type, x.category, x.amount, x.currency || currency, x.note || ''])
    })
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `bullbir-finance-${toDateKey()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const budgetPct = budget > 0 ? Math.min(100, (expense / budget) * 100) : 0
  const budgetFree = budget > 0 ? Math.max(0, budget - expense) : balance
  const inBudget = budget > 0 && expense <= budget
  const monthLabel = new Date().toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'kg' ? 'ky-KG' : 'en-US', { month: 'long', year: 'numeric' })
  const maxCat = byCategory.length > 0 ? byCategory[0].value : 1

  return (
    <div>
      {/* Header */}
      <div className="module-header">
        <div>
          <h2 style={{ letterSpacing: '-0.02em' }}>{t('fin.title')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>
            {monthLabel}{budget > 0 && (inBudget ? ' · ты в рамках бюджета 👍' : ' · бюджет превышен ⚠️')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select className="select" style={{ width: 'auto' }} value={currency} onChange={e => setCurrency(e.target.value)}>
            {Object.keys(CURRENCIES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={exportCSV}>{t('fin.export')}</button>
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            {t('fin.newTxn')}
          </button>
        </div>
      </div>

      {/* Balance hero + income/expense row */}
      <div className="fin-hero-row">
        {/* Budget / Balance hero card */}
        <div className="fin-hero-card">
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)', fontWeight: 500 }}>
            {budget > 0 ? (t('fin.budgetFree') || 'Свободно в бюджете') : (t('fin.balance') || 'Баланс')}
          </div>
          <div className="fin-hero-amount">{formatMoney(budgetFree, currency)}</div>
          {budget > 0 && (
            <>
              <div className="fin-hero-bar">
                <div className="fin-hero-fill" style={{ width: `${budgetPct}%`, background: budgetPct >= 100 ? '#e06a9a' : '#fff' }} />
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>
                {formatMoney(expense, currency)} из {formatMoney(budget, currency)} потрачено
              </div>
            </>
          )}
          {budget === 0 && (
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Бюджет:</span>
              <input
                type="number"
                placeholder="Установить"
                className="fin-budget-input"
                value={budget || ''}
                onChange={e => setBudget(parseFloat(e.target.value) || 0)}
              />
            </div>
          )}
        </div>

        {/* Income */}
        <div className="card fin-stat-card">
          <div className="fin-stat-icon income">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="fin-stat-amt">{formatMoney(income, currency)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{t('fin.income') || 'доходы'}</div>
        </div>

        {/* Expense */}
        <div className="card fin-stat-card">
          <div className="fin-stat-icon expense">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round"/>
            </svg>
          </div>
          <div className="fin-stat-amt">{formatMoney(expense, currency)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>{t('fin.expense') || 'расходы'}</div>
        </div>
      </div>

      {budget > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setBudget(0)}>Сбросить бюджет</button>
          <input
            type="number"
            className="input"
            style={{ width: 140, height: 34, fontSize: 13, marginLeft: 8 }}
            placeholder="Изменить"
            value={budget || ''}
            onChange={e => setBudget(parseFloat(e.target.value) || 0)}
          />
        </div>
      )}

      {/* Categories + Transactions grid */}
      {items.length > 0 && (
        <div className="fin-bottom-grid">
          {/* Categories */}
          {byCategory.length > 0 && (
            <div className="card">
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 18 }}>
                {t('fin.byCategory') || 'По категориям'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {byCategory.slice(0, 6).map(({ id, value }, i) => (
                  <div key={id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {catEmoji('expense', id)} {catLabel(t, id)}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                        {formatMoney(value, currency)}
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--bg)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.round((value / maxCat) * 100)}%`,
                        height: '100%',
                        background: CAT_COLORS[i % CAT_COLORS.length],
                        borderRadius: 99,
                        transition: 'width 0.4s',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transactions */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                {t('fin.txns') || 'Операции'}
              </span>
              <span style={{ fontSize: 13, color: '#9a8cff', fontWeight: 600 }}>
                {items.length} {t('fin.total') || 'всего'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <AnimatePresence>
                {items.slice(0, 20).map((x, i) => {
                  const d = toDate(x.date)
                  const dateStr = d ? d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' }) : ''
                  return (
                    <motion.div
                      key={x.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="fin-txn-row"
                      style={{ borderBottom: i < items.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
                    >
                      <div className="fin-txn-icon">{catEmoji(x.type, x.category)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                          {x.note || catLabel(t, x.category)}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>
                          {catLabel(t, x.category)} · {dateStr}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 14.5, fontWeight: 700,
                        color: x.type === 'income' ? '#5ad1a5' : '#f47a55',
                        whiteSpace: 'nowrap',
                      }}>
                        {x.type === 'income' ? '+' : '−'}{formatMoney(x.amount, x.currency || currency)}
                      </span>
                      <button
                        style={{ color: 'var(--text-muted)', padding: '4px 6px', fontSize: 16, opacity: 0, transition: 'opacity 0.15s' }}
                        className="fin-del-btn"
                        onClick={() => remove(x.id)}
                      >×</button>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', marginTop: 16 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>💰</div>
          <h3>{t('fin.empty') || 'Добавьте первую операцию'}</h3>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setModalOpen(true)}>
            + {t('fin.newTxn')}
          </button>
        </div>
      )}

      {/* Add transaction modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('fin.newTxn') || 'Новая операция'}>
        <div className="tasks-tabs" style={{ marginBottom: 16 }}>
          <button
            className={`tasks-tab${form.type === 'expense' ? ' active' : ''}`}
            onClick={() => setForm(f => ({ ...f, type: 'expense', category: 'food' }))}
          >{t('fin.expense') || 'Расход'}</button>
          <button
            className={`tasks-tab${form.type === 'income' ? ' active' : ''}`}
            onClick={() => setForm(f => ({ ...f, type: 'income', category: 'salary' }))}
          >{t('fin.income') || 'Доход'}</button>
        </div>

        <div className="field">
          <label>{t('fin.amount') || 'Сумма'}</label>
          <input type="number" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} autoFocus placeholder="0" />
        </div>

        <div className="field">
          <label>{t('fin.category') || 'Категория'}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORIES[form.type].map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setForm(f => ({ ...f, category: c.id }))}
                style={{
                  padding: '7px 14px', borderRadius: 99, fontSize: 13, fontWeight: 600,
                  background: form.category === c.id ? '#7c5cff' : 'var(--surface-2)',
                  color: form.category === c.id ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${form.category === c.id ? '#7c5cff' : 'var(--border)'}`,
                }}
              >{c.emoji} {catLabel(t, c.id)}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('common.description') || 'Описание'} <span style={{ color: 'var(--text-muted)' }}>({t('common.optional') || 'необязательно'})</span></label>
          <input className="input" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder={catLabel(t, form.category)} />
        </div>

        <div className="field">
          <label>{t('common.date') || 'Дата'}</label>
          <input type="date" className="input" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </div>

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} onClick={save}>
          {t('common.save') || 'Сохранить'}
        </button>
      </Modal>
    </div>
  )
}
