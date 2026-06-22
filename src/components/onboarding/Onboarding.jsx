import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useTheme } from '../../context/ThemeContext'
import Logo from '../ui/Logo'
import Confetti from './Confetti'
import './Onboarding.css'

export default function Onboarding() {
  const { user, completeOnboarding } = useAuth()
  const { t, lang, setLang, languages } = useLang()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const [step, setStep] = useState(0)
  const [firstTask, setFirstTask] = useState('')
  const [celebrate, setCelebrate] = useState(false)
  const [saving, setSaving] = useState(false)

  const steps = ['lang', 'theme', 'task', 'done']

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const goToTask = async () => {
    setSaving(true)
    try {
      if (firstTask.trim() && user) {
        await addDoc(collection(db, `users/${user.uid}/tasks`), {
          title: firstTask.trim(),
          status: 'todo',
          priority: 'medium',
          tags: [],
          subtasks: [],
          deadline: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
      setCelebrate(true)
      next()
    } finally {
      setSaving(false)
    }
  }

  const finish = async () => {
    await completeOnboarding({ language: lang, theme })
    navigate('/app/dashboard')
  }

  return (
    <div className="onb-page">
      {celebrate && <Confetti />}
      <div className="onb-progress">
        {steps.map((s, i) => (
          <span key={s} className={`onb-dot ${i <= step ? 'active' : ''}`} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={steps[step]}
          className="onb-step"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.35 }}
        >
          {step === 0 && (
            <>
              <Logo size={72} animated />
              <h1>{t('onb.welcome')}</h1>
              <p className="text-secondary">{t('onb.chooseLang')}</p>
              <div className="onb-options">
                {languages.map((l) => (
                  <button
                    key={l.code}
                    className={`onb-option ${lang === l.code ? 'selected' : ''}`}
                    onClick={() => setLang(l.code)}
                  >
                    <span className="onb-flag">{l.flag}</span>
                    {l.label}
                  </button>
                ))}
              </div>
              <button className="btn btn-primary btn-block" onClick={next}>
                {t('common.next')}
              </button>
            </>
          )}

          {step === 1 && (
            <>
              <h1>{t('onb.chooseTheme')}</h1>
              <div className="onb-themes">
                <button className={`onb-theme light ${theme === 'light' ? 'selected' : ''}`} onClick={() => setTheme('light')}>
                  <div className="onb-theme-preview onb-light-preview" />
                  {t('onb.light')}
                </button>
                <button className={`onb-theme dark ${theme === 'dark' ? 'selected' : ''}`} onClick={() => setTheme('dark')}>
                  <div className="onb-theme-preview onb-dark-preview" />
                  {t('onb.dark')}
                </button>
              </div>
              <div className="onb-actions">
                <button className="btn btn-ghost" onClick={back}>{t('common.back')}</button>
                <button className="btn btn-primary" onClick={next}>{t('common.next')}</button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1>{t('onb.firstTask')}</h1>
              <p className="text-secondary">{t('onb.firstTaskHint')}</p>
              <input
                className="input"
                value={firstTask}
                onChange={(e) => setFirstTask(e.target.value)}
                placeholder={t('onb.firstTaskPlaceholder')}
                autoFocus
              />
              <div className="onb-actions">
                <button className="btn btn-ghost" onClick={goToTask} disabled={saving}>{t('common.skip')}</button>
                <button className="btn btn-primary" onClick={goToTask} disabled={saving}>
                  {saving ? <span className="spinner" /> : t('common.next')}
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 14 }}>
                <Logo size={88} />
              </motion.div>
              <h1>{t('onb.done')}</h1>
              <p className="text-secondary">{t('onb.doneSubtitle')}</p>
              <button className="btn btn-primary btn-block" onClick={finish}>
                {t('onb.start')}
              </button>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
