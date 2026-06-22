import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { format, subDays, eachDayOfInterval } from 'date-fns'
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { useCollection } from '../../hooks/useCollection'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import { toDateKey } from '../../utils/format'

const MOODS = [
  { value: 0, emoji: '😔', key: 'mood.veryBad' },
  { value: 1, emoji: '😕', key: 'mood.bad' },
  { value: 2, emoji: '😐', key: 'mood.ok' },
  { value: 3, emoji: '🙂', key: 'mood.good' },
  { value: 4, emoji: '😄', key: 'mood.great' },
]

export default function MoodTracker() {
  const { user } = useAuth()
  const { items } = useCollection('moods', { orderField: 'date', direction: 'desc' })
  const { t } = useLang()
  const toast = useToast()
  const [range, setRange] = useState('week')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(null)

  const todayKey = toDateKey()
  const todayMood = useMemo(() => items.find((m) => m.date === todayKey), [items, todayKey])

  const streak = useMemo(() => {
    const set = new Set(items.map((m) => m.date))
    let count = 0
    let d = new Date()
    while (set.has(toDateKey(d))) { count += 1; d = subDays(d, 1) }
    return count
  }, [items])

  const chartData = useMemo(() => {
    const days = range === 'week' ? 7 : 30
    const range_ = eachDayOfInterval({ start: subDays(new Date(), days - 1), end: new Date() })
    const map = Object.fromEntries(items.map((m) => [m.date, m.value]))
    return range_.map((d) => ({ name: format(d, days <= 7 ? 'EEE' : 'd'), value: map[toDateKey(d)] ?? null }))
  }, [items, range])

  const checkIn = async () => {
    if (pending === null || !user) return
    await setDoc(doc(collection(db, `users/${user.uid}/moods`), todayKey), {
      value: pending, note: note.trim(), date: todayKey, createdAt: serverTimestamp(),
    })
    toast.success(t('mood.checkedIn'))
    setNote('')
    setPending(null)
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 'var(--space-5)', textAlign: 'center' }}>
        <h2 style={{ marginBottom: 'var(--space-4)' }}>{t('mood.howAreYou')}</h2>
        {todayMood ? (
          <div>
            <div style={{ fontSize: 64 }}>{MOODS[todayMood.value].emoji}</div>
            <p className="text-secondary">{t('mood.checkedIn')}</p>
            {todayMood.note && <p className="text-muted" style={{ marginTop: 8 }}>{todayMood.note}</p>}
          </div>
        ) : (
          <>
            <div className="mood-big" style={{ marginBottom: 'var(--space-4)' }}>
              {MOODS.map((m) => (
                <motion.button key={m.value} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className={`mood-big-pill ${pending === m.value ? 'selected' : ''}`} onClick={() => setPending(m.value)}>
                  {m.emoji}
                </motion.button>
              ))}
            </div>
            <input className="input" style={{ maxWidth: 420, margin: '0 auto var(--space-4)' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('mood.note')} />
            <div>
              <button className="btn btn-primary" disabled={pending === null} onClick={checkIn}>{t('common.save')}</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
          <span className="streak-badge">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3-1 5-2 6 2 0 4 2 4 5a4 4 0 0 1-8 0c0-2 1-3 1-3s3 1 2-3c2 1 4 4 1 6 3-1 5-4 5-7 0-4-3-6-4-7Z" /></svg>
            {streak} {t('mood.streak')}
          </span>
          <div className="view-toggle">
            <button className={range === 'week' ? 'active' : ''} onClick={() => setRange('week')}>{t('mood.week')}</button>
            <button className={range === 'month' ? 'active' : ''} onClick={() => setRange('month')}>{t('mood.month')}</button>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-6)' }}>{t('mood.empty')}</p>
        ) : (
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="moodGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5b4fcf" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#5b4fcf" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="name" fontSize={11} stroke="var(--text-muted)" />
                <YAxis domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} tickFormatter={(v) => MOODS[v]?.emoji || ''} stroke="var(--text-muted)" width={30} />
                <Tooltip formatter={(v) => (v === null ? '—' : t(MOODS[v].key))} />
                <Area type="monotone" dataKey="value" stroke="#5b4fcf" strokeWidth={2} fill="url(#moodGrad)" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
