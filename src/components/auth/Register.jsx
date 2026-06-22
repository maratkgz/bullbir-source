import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import AuthShell from './AuthShell'
import OAuthButtons from './OAuthButtons'

function Rule({ ok, label }) {
  return (
    <span className={`pw-rule ${ok ? 'ok' : ''}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {ok ? <path d="M20 6 9 17l-5-5" /> : <circle cx="12" cy="12" r="9" />}
      </svg>
      {label}
    </span>
  )
}

export default function Register() {
  const { register } = useAuth()
  const { t, tError } = useLang()
  const toast = useToast()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(false)

  const checks = useMemo(
    () => ({
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      number: /\d/.test(password),
      match: password.length > 0 && password === confirm,
    }),
    [password, confirm],
  )

  const valid = checks.length && checks.upper && checks.number && checks.match

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!valid) {
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    setLoading(true)
    try {
      await register({ email, password, name })
      toast.success(t('auth.verificationSent'))
      navigate('/verify-email')
    } catch (err) {
      toast.error(tError(err))
      setShake(true)
      setTimeout(() => setShake(false), 500)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title={t('auth.createAccount')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="auth-link">
            {t('auth.login')}
          </Link>
        </>
      }
    >
      <motion.form
        className="auth-form"
        onSubmit={onSubmit}
        animate={shake ? { x: [0, -8, 8, -6, 6, 0] } : {}}
        transition={{ duration: 0.4 }}
      >
        <div className="field">
          <label htmlFor="name">{t('auth.name')}</label>
          <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="email">{t('auth.email')}</label>
          <input id="email" type="email" className="input" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="field">
          <label htmlFor="password">{t('auth.password')}</label>
          <input id="password" type="password" className="input" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="field">
          <label htmlFor="confirm">{t('auth.confirmPassword')}</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            className={`input ${confirm && !checks.match ? 'error' : ''}`}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <div className="pw-rules">
          <Rule ok={checks.length} label={t('pw.minLength')} />
          <Rule ok={checks.upper} label={t('pw.uppercase')} />
          <Rule ok={checks.number} label={t('pw.number')} />
          <Rule ok={checks.match} label={t('pw.match')} />
        </div>
        <button className="btn btn-primary btn-block" disabled={loading || !valid}>
          {loading ? <span className="spinner" /> : t('auth.register')}
        </button>
      </motion.form>

      <div className="auth-divider">{t('auth.continueWith')}</div>
      <OAuthButtons />
    </AuthShell>
  )
}
