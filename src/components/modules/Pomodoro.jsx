import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useLang } from '../../context/LangContext'
import { toDate, toDateKey } from '../../utils/format'

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
    osc.onended = () => ctx.close()
  } catch {
    /* audio unavailable */
  }
}

export default function Pomodoro() {
  const { items, add } = useCollection('pomodoro', { orderField: 'createdAt' })
  const { t } = useLang()
  const [settings, setSettings] = useLocalStorage('bullbir_pomodoro', { focus: 25, break: 5, sound: true })

  const [mode, setMode] = useState('focus') // focus | break
  const [secondsLeft, setSecondsLeft] = useState(settings.focus * 60)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef(null)

  const total = (mode === 'focus' ? settings.focus : settings.break) * 60
  const progress = 1 - secondsLeft / total

  const reset = useCallback((m = mode) => {
    setRunning(false)
    setSecondsLeft((m === 'focus' ? settings.focus : settings.break) * 60)
  }, [mode, settings])

  const complete = useCallback(async () => {
    setRunning(false)
    if (settings.sound) beep()
    if (mode === 'focus') {
      await add({ minutes: settings.focus, date: toDateKey() })
      setMode('break')
      setSecondsLeft(settings.break * 60)
    } else {
      setMode('focus')
      setSecondsLeft(settings.focus * 60)
    }
  }, [mode, settings, add])

  useEffect(() => {
    if (!running) return undefined
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearInterval(intervalRef.current); complete(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [running, complete])

  // Re-sync timer when settings change while idle.
  useEffect(() => {
    if (!running) setSecondsLeft((mode === 'focus' ? settings.focus : settings.break) * 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.focus, settings.break, mode])

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')

  const todayCount = items.filter((i) => i.date === toDateKey()).length
  const R = 120
  const C = 2 * Math.PI * R

  return (
    <div className="pomo-wrap">
      <div className="view-toggle">
        <button className={mode === 'focus' ? 'active' : ''} onClick={() => { setMode('focus'); reset('focus') }}>{t('pomo.focus')}</button>
        <button className={mode === 'break' ? 'active' : ''} onClick={() => { setMode('break'); reset('break') }}>{t('pomo.break')}</button>
      </div>

      <div className="pomo-ring">
        <svg width="100%" height="100%" viewBox="0 0 280 280">
          <circle cx="140" cy="140" r={R} fill="none" stroke="var(--bg-secondary)" strokeWidth="14" />
          <motion.circle
            cx="140" cy="140" r={R} fill="none"
            stroke={mode === 'focus' ? 'var(--primary)' : 'var(--success)'}
            strokeWidth="14" strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - progress)}
            transform="rotate(-90 140 140)"
            animate={{ strokeDashoffset: C * (1 - progress) }}
            transition={{ ease: 'linear', duration: 0.5 }}
          />
        </svg>
        <div className="pomo-time">
          <span className="pomo-mode">{mode === 'focus' ? t('pomo.focus') : t('pomo.break')}</span>
          <span className="time">{mm}:{ss}</span>
        </div>
      </div>

      <div className="pomo-controls">
        <button className="btn btn-primary" onClick={() => setRunning((r) => !r)} style={{ minWidth: 120 }}>
          {running ? t('pomo.pause') : t('pomo.start')}
        </button>
        <button className="btn btn-ghost" onClick={() => reset()}>{t('pomo.reset')}</button>
        <button className="btn btn-ghost" onClick={complete}>{t('pomo.skip')}</button>
      </div>

      <p className="text-secondary">{t('pomo.sessions')}: <strong>{todayCount}</strong></p>

      <div className="card" style={{ width: '100%', maxWidth: 480 }}>
        <span className="section-title">{t('pomo.settings')}</span>
        <div className="settings-row">
          <label>{t('pomo.focusLen')}</label>
          <input type="number" className="input" style={{ width: 90 }} min={1} value={settings.focus} onChange={(e) => setSettings((s) => ({ ...s, focus: Math.max(1, parseInt(e.target.value) || 1) }))} />
        </div>
        <div className="settings-row">
          <label>{t('pomo.breakLen')}</label>
          <input type="number" className="input" style={{ width: 90 }} min={1} value={settings.break} onChange={(e) => setSettings((s) => ({ ...s, break: Math.max(1, parseInt(e.target.value) || 1) }))} />
        </div>
        <div className="settings-row">
          <label>{t('pomo.sound')}</label>
          <button className={`toggle ${settings.sound ? 'on' : ''}`} onClick={() => setSettings((s) => ({ ...s, sound: !s.sound }))}><span className="toggle-knob" /></button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="card" style={{ width: '100%', maxWidth: 480 }}>
          <span className="section-title">{t('pomo.history')}</span>
          <div className="list-stack">
            {items.slice(-8).reverse().map((i) => (
              <div key={i.id} className="flex items-center justify-between">
                <span>{i.minutes} {t('pomo.focusLen').replace(/\(.*\)/, '').trim()}</span>
                <span className="text-muted mono">{toDate(i.createdAt) ? format(toDate(i.createdAt), 'd MMM HH:mm') : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
