import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { format, addDays, subDays } from 'date-fns'
import { useDoc } from '../../hooks/useDoc'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import RichEditor from '../ui/RichEditor'
import { toDateKey } from '../../utils/format'

const MOODS = [
  { value: 0, emoji: '😔' },
  { value: 1, emoji: '😕' },
  { value: 2, emoji: '😐' },
  { value: 3, emoji: '🙂' },
  { value: 4, emoji: '😄' },
]

function countWords(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.length
}

export default function Journal() {
  const { t } = useLang()
  const toast = useToast()
  const [date, setDate] = useState(new Date())
  const dateKey = toDateKey(date)
  const { data, loading, save } = useDoc('journals', dateKey)

  const [content, setContent] = useState('')
  const [mood, setMood] = useState(null)
  const [isPrivate, setIsPrivate] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    setContent(data?.content || '')
    setMood(data?.mood ?? null)
    setIsPrivate(data?.private || false)
  }, [data, dateKey])

  const persist = useCallback(
    (patch) => {
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        save({ content, mood, private: isPrivate, date: dateKey, ...patch }).then(() =>
          toast.success(t('common.saved')),
        )
      }, 800)
    },
    [content, mood, isPrivate, dateKey, save, toast, t],
  )

  const onContentChange = (html) => {
    setContent(html)
    persist({ content: html })
  }
  const onMood = (v) => {
    const next = mood === v ? null : v
    setMood(next)
    persist({ mood: next })
  }
  const onPrivate = () => {
    const next = !isPrivate
    setIsPrivate(next)
    persist({ private: next })
  }

  return (
    <div>
      <div className="page-header">
        <div className="date-nav">
          <button className="btn btn-ghost btn-icon" onClick={() => setDate((d) => subDays(d, 1))} aria-label={t('journal.prevDay')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <span className="date-label">{format(date, 'EEEE, d MMM yyyy')}</span>
          <button className="btn btn-ghost btn-icon" onClick={() => setDate((d) => addDays(d, 1))} disabled={dateKey >= toDateKey()} aria-label={t('journal.nextDay')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <div className="flex gap-3 items-center">
          <button className={`btn ${isPrivate ? 'btn-secondary' : 'btn-ghost'}`} onClick={onPrivate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            {t('journal.private')}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
          <span className="section-title" style={{ margin: 0 }}>{t('journal.moodTag')}</span>
          <span className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{countWords(content)} {t('journal.wordCount')}</span>
        </div>
        <div className="mood-pills">
          {MOODS.map((m) => (
            <motion.button key={m.value} whileTap={{ scale: 0.9 }} className={`mood-pill ${mood === m.value ? 'selected' : ''}`} onClick={() => onMood(m.value)}>
              {m.emoji}
            </motion.button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="editor" />
      ) : (
        <RichEditor value={content} onChange={onContentChange} placeholder={t('journal.placeholder')} />
      )}
    </div>
  )
}
