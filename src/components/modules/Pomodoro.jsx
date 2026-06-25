import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { useCollection } from '../../hooks/useCollection'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useLang } from '../../context/LangContext'
import { toDate, toDateKey } from '../../utils/format'

const DURATIONS = [25, 45, 60]

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'; osc.frequency.value = 880
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.start(); osc.stop(ctx.currentTime + 0.6)
    osc.onended = () => ctx.close()
  } catch { /* audio unavailable */ }
}

export default function Pomodoro() {
  const { items, add } = useCollection('pomodoro', { orderField: 'createdAt' })
  const { t } = useLang()
  const [settings, setSettings] = useLocalStorage('bullbir_pomodoro', { focus: 25, break: 5, sound: true })
  const [mode, setMode] = useState('focus') // focus | break
  const [secondsLeft, setSecondsLeft] = useState(settings.focus * 60)
  const [running, setRunning] = useState(false)
  const [task, setTask] = useState('')
  const intervalRef = useRef(null)

  const total = (mode === 'focus' ? settings.focus : settings.break) * 60
  const progress = 1 - secondsLeft / total
  const pct = Math.round(progress * 100)

  const reset = useCallback((m = mode) => {
    setRunning(false)
    setSecondsLeft((m === 'focus' ? settings.focus : settings.break) * 60)
  }, [mode, settings])

  const complete = useCallback(async () => {
    setRunning(false)
    if (settings.sound) beep()
    if (mode === 'focus') {
      await add({ minutes: settings.focus, date: toDateKey(), task: task.trim() || null })
      setMode('break'); setSecondsLeft(settings.break * 60)
    } else {
      setMode('focus'); setSecondsLeft(settings.focus * 60)
    }
  }, [mode, settings, add, task])

  useEffect(() => {
    if (!running) return undefined
    intervalRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { clearInterval(intervalRef.current); complete(); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [running, complete])

  useEffect(() => {
    if (!running) setSecondsLeft((mode === 'focus' ? settings.focus : settings.break) * 60)
  }, [settings.focus, settings.break, mode]) // eslint-disable-line

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')

  const todayItems = items.filter(i => i.date === toDateKey())
  const todaySessions = todayItems.length
  const todayMinutes = todayItems.reduce((a, i) => a + (i.minutes || 0), 0)
  const todayHours = Math.floor(todayMinutes / 60)
  const todayMins = todayMinutes % 60
  const sessionNum = todaySessions + (mode === 'focus' ? 1 : 0)

  return (
    <div className="pomo-layout">
      {/* Main timer column */}
      <div className="pomo-center">
        {/* Session badge */}
        <div className="pomo-session-badge">
          Сессия {sessionNum} из 4
        </div>

        {/* Task label */}
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
            {mode === 'break' ? '☕ Время отдыха' : 'Сейчас в фокусе'}
          </div>
          {mode === 'focus' && (
            <input
              className="pomo-task-input"
              placeholder="Над чем работаешь?"
              value={task}
              onChange={e => setTask(e.target.value)}
              disabled={running}
            />
          )}
        </div>

        {/* Ring */}
        <div className="pomo-ring-wrap" style={{ marginTop: mode === 'focus' ? 28 : 36 }}>
          <div
            className="pomo-ring-outer"
            style={{
              background: mode === 'break'
                ? `conic-gradient(#5ad1a5 ${pct}%, #1a1a26 0)`
                : `conic-gradient(#7c5cff ${pct}%, #1a1a26 0)`,
              boxShadow: mode === 'break'
                ? '0 0 60px -10px rgba(90,209,165,0.4)'
                : '0 0 60px -10px rgba(124,92,255,0.4)',
            }}
          >
            <div className={`pomo-ring-inner${mode === 'break' ? ' break-mode' : ''}`}>
              <span className="pomo-time-display">{mm}:{ss}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, marginTop: 8 }}>
                {mode === 'break' ? 'до конца перерыва' : 'осталось до перерыва'}
              </span>
            </div>
          </div>
        </div>

        {/* Session dots */}
        <div className="pomo-dots">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="pomo-dot"
              style={{
                width: i === sessionNum - 1 && running ? 24 : 9,
                background: i < todaySessions ? (mode === 'break' ? '#5ad1a5' : '#7c5cff') : 'rgba(255,255,255,0.18)',
              }}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="pomo-controls">
          <button className="pomo-ctrl-btn secondary" onClick={() => reset()} title="Сбросить">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
          </button>
          <motion.button
            className={`pomo-ctrl-btn main${mode === 'break' ? ' break-btn' : ''}`}
            whileTap={{ scale: 0.94 }}
            onClick={() => setRunning(r => !r)}
          >
            {running ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>
            )}
          </motion.button>
          <button className="pomo-ctrl-btn secondary" onClick={complete} title="Пропустить">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 4l10 8-10 8V4z"/><path d="M19 5v14"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Right stats column */}
      <div className="pomo-sidebar">
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>Сегодня</div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <div className="card pomo-stat">
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>{todaySessions}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>сессий</div>
          </div>
          <div className="card pomo-stat">
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>
              {todayHours > 0 ? `${todayHours}ч ${todayMins}м` : `${todayMins}м`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>в фокусе</div>
          </div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', margin: '22px 0 10px' }}>
          Длительность фокуса
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {DURATIONS.map(d => (
            <button
              key={d}
              onClick={() => { setSettings(s => ({ ...s, focus: d })); if (!running) reset('focus') }}
              style={{
                flex: 1, textAlign: 'center', padding: '11px 4px',
                borderRadius: 12, fontSize: 13, fontWeight: settings.focus === d ? 700 : 600,
                background: settings.focus === d ? '#7c5cff' : '#13131c',
                color: settings.focus === d ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${settings.focus === d ? '#7c5cff' : '#23232f'}`,
                transition: 'all 0.15s',
              }}
            >{d}м</button>
          ))}
        </div>

        {/* Break duration */}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', margin: '16px 0 10px' }}>
          Перерыв
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[5, 10, 15].map(d => (
            <button
              key={d}
              onClick={() => setSettings(s => ({ ...s, break: d }))}
              style={{
                flex: 1, textAlign: 'center', padding: '11px 4px',
                borderRadius: 12, fontSize: 13, fontWeight: settings.break === d ? 700 : 600,
                background: settings.break === d ? 'rgba(90,209,165,0.18)' : '#13131c',
                color: settings.break === d ? '#5ad1a5' : 'var(--text-muted)',
                border: `1px solid ${settings.break === d ? '#5ad1a5' : '#23232f'}`,
                transition: 'all 0.15s',
              }}
            >{d}м</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Звук</span>
          <button
            className={`toggle${settings.sound ? ' on' : ''}`}
            onClick={() => setSettings(s => ({ ...s, sound: !s.sound }))}
          ><span className="toggle-knob" /></button>
        </div>

        {todayItems.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', margin: '22px 0 12px' }}>Сессии дня</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {todayItems.slice(-6).reverse().map((item, i) => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(124,92,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9a8cff', fontSize: 16 }}>✓</div>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {item.task || `Сессия ${todayItems.length - i}`}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{item.minutes}м</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
