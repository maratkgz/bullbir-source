import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import AuthShell from './AuthShell'

const RESEND_COOLDOWN_S = 45
const CODE_LENGTH = 6

export default function VerifyEmail() {
  const { user, pendingEmail, hasRegistrationPassword, verifyEmail, resendVerification, logout } = useAuth()
  const { t, tError } = useLang()
  const toast = useToast()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  // After a reload the registration password is gone from memory — ask for it again.
  const [password, setPassword] = useState('')
  const needsPassword = !hasRegistrationPassword
  const canSubmit = code.length === CODE_LENGTH && (!needsPassword || password.length > 0)
  const [verifying, setVerifying] = useState(false)
  const [shake, setShake] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const email = user?.email ?? pendingEmail

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const id = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  const onVerify = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setVerifying(true)
    try {
      await verifyEmail(code, needsPassword ? password : undefined)
      // A fresh session now exists; OnboardingRoute forwards to the dashboard if already done.
      navigate('/onboarding', { replace: true })
    } catch (err) {
      toast.error(tError(err))
      setCode('')
      setShake(true)
      setTimeout(() => setShake(false), 500)
    } finally {
      setVerifying(false)
    }
  }

  const onResend = async () => {
    try {
      await resendVerification(needsPassword ? password : undefined)
      toast.success(t('auth.verificationSent'))
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      toast.error(tError(err))
    }
  }

  return (
    <AuthShell title={t('auth.verifyEmail')} subtitle={t('auth.verifyEmailSubtitle')}>
      <motion.form
        className="auth-form"
        onSubmit={onVerify}
        initial={{ opacity: 0, y: 12 }}
        animate={shake ? { opacity: 1, y: 0, x: [0, -8, 8, -6, 6, 0] } : { opacity: 1, y: 0 }}
      >
        <p style={{ textAlign: 'center', fontWeight: 600, color: 'var(--primary)' }}>{email}</p>
        <div className="field">
          <label htmlFor="code">{t('auth.enterCode')}</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            className="input mono"
            style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 'var(--text-lg)' }}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            placeholder="000000"
          />
        </div>
        {needsPassword && (
          <div className="field">
            <label htmlFor="password">{t('auth.verifyPasswordLabel')}</label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={verifying || !canSubmit}>
          {verifying ? <span className="spinner" /> : t('auth.verifyCode')}
        </button>
        <button type="button" className="btn btn-secondary btn-block" onClick={onResend} disabled={cooldown > 0 || (needsPassword && !password)}>
          {cooldown > 0 ? `${t('auth.resendVerification')} (${cooldown})` : t('auth.resendVerification')}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={logout}>
          {user ? t('auth.logout') : t('auth.backToLogin')}
        </button>
      </motion.form>
    </AuthShell>
  )
}
