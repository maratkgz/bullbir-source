import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import AuthShell from './AuthShell'
import OAuthButtons from './OAuthButtons'

function EyeButton({ shown, onClick }) {
  return (
    <button type="button" className="input-eye" onClick={onClick} tabIndex={-1} aria-label="toggle">
      {shown ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M6.6 6.6A18 18 0 0 0 2 11s3.5 7 10 7a10.9 10.9 0 0 0 4-.7M3 3l18 18" />
        </svg>
      )}
    </button>
  )
}

export default function Login() {
  const { login, sendPhoneCode } = useAuth()
  const { t, tError } = useLang()
  const toast = useToast()
  const navigate = useNavigate()

  const [mode, setMode] = useState('email') // 'email' | 'phone'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(false)

  // phone
  const [phone, setPhone] = useState('+996')
  const [confirmation, setConfirmation] = useState(null)
  const [code, setCode] = useState('')

  const fail = (err) => {
    toast.error(tError(err))
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  const onEmailSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login({ email, password })
      navigate('/app/dashboard')
    } catch (err) {
      fail(err)
    } finally {
      setLoading(false)
    }
  }

  const onSendCode = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const conf = await sendPhoneCode(phone, 'recaptcha-container')
      setConfirmation(conf)
      toast.success(t('auth.codeSent'))
    } catch (err) {
      fail(err)
    } finally {
      setLoading(false)
    }
  }

  const onVerifyCode = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await confirmation.confirm(code)
      navigate('/app/dashboard')
    } catch (err) {
      fail(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title={t('auth.welcomeBack')}
      subtitle={t('auth.loginSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="auth-link">
            {t('auth.register')}
          </Link>
        </>
      }
    >
      <motion.div animate={shake ? { x: [0, -8, 8, -6, 6, 0] } : {}} transition={{ duration: 0.4 }}>
        <AnimatePresence mode="wait">
          {mode === 'email' ? (
            <motion.form
              key="email"
              className="auth-form"
              onSubmit={onEmailSubmit}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="field">
                <label htmlFor="email">{t('auth.email')}</label>
                <input
                  id="email"
                  type="email"
                  className="input"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="field">
                <label htmlFor="password">{t('auth.password')}</label>
                <div className="input-wrap">
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    className="input"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <EyeButton shown={showPw} onClick={() => setShowPw((s) => !s)} />
                </div>
              </div>
              <div style={{ textAlign: 'right', marginTop: -8 }}>
                <Link to="/forgot-password" className="auth-link" style={{ fontSize: 'var(--text-sm)' }}>
                  {t('auth.forgotPassword')}
                </Link>
              </div>
              <button className="btn btn-primary btn-block" disabled={loading}>
                {loading ? <span className="spinner" /> : t('auth.login')}
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={() => setMode('phone')}>
                {t('auth.usePhone')}
              </button>
            </motion.form>
          ) : (
            <motion.form
              key="phone"
              className="auth-form"
              onSubmit={confirmation ? onVerifyCode : onSendCode}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {!confirmation ? (
                <div className="field">
                  <label htmlFor="phone">{t('auth.phone')}</label>
                  <input
                    id="phone"
                    type="tel"
                    className="input"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+996 700 000 000"
                  />
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="code">{t('auth.enterCode')}</label>
                  <input
                    id="code"
                    inputMode="numeric"
                    maxLength={6}
                    className="input mono"
                    style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 'var(--text-lg)' }}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                  />
                </div>
              )}
              <button className="btn btn-primary btn-block" disabled={loading}>
                {loading ? (
                  <span className="spinner" />
                ) : confirmation ? (
                  t('auth.verifyCode')
                ) : (
                  t('auth.sendCode')
                )}
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={() => setMode('email')}>
                {t('auth.useEmail')}
              </button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="auth-divider">{t('auth.continueWith')}</div>
      <OAuthButtons />
      <div id="recaptcha-container" />
    </AuthShell>
  )
}
