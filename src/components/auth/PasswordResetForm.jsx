import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import NewPasswordFields from './NewPasswordFields'
import { checkNewPassword, isNewPasswordValid } from './passwordPolicy'

// Same code UX as EmailCodeLogin: 8 digits, resend every 60 s, bound to this browser by cookie.
const RESEND_COOLDOWN_S = 60
const CODE_LENGTH = 8

/**
 * Password reset by email code (also "set a password" for Google / code-only accounts).
 * Step 1: email → code. Step 2: code + new password → fresh session.
 * @param {{ initialEmail?: string, lockEmail?: boolean, onSuccess: () => void, onCancel?: () => void }} props
 */
export default function PasswordResetForm({ initialEmail = '', lockEmail = false, onSuccess, onCancel }) {
  const { requestPasswordReset, confirmPasswordReset } = useAuth()
  const { t, tError } = useLang()
  const toast = useToast()
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const id = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  const checks = checkNewPassword(password, confirm)
  const canConfirm = code.length === CODE_LENGTH && isNewPasswordValid(checks)

  const sendCode = async () => {
    setLoading(true)
    try {
      await requestPasswordReset(email.trim())
      setSent(true)
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      toast.error(tError(err))
    } finally {
      setLoading(false)
    }
  }

  const confirmReset = async () => {
    if (!canConfirm) return
    setLoading(true)
    try {
      await confirmPasswordReset(email.trim(), code, password)
      toast.success(t('auth.passwordResetDone'))
      onSuccess()
    } catch (err) {
      setCode('')
      toast.error(tError(err))
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = (e) => {
    e.preventDefault()
    if (sent) confirmReset()
    else sendCode()
  }

  const onBackClick = () => {
    if (!sent) {
      onCancel?.()
      return
    }
    setSent(false)
    setCode('')
  }

  const submitLabel = sent ? t('auth.setNewPassword') : t('auth.sendCode')
  const resendLabel = cooldown > 0 ? `${t('auth.resendCode')} (${cooldown})` : t('auth.resendCode')
  const showBack = sent || !!onCancel

  return (
    <motion.form className="auth-form" onSubmit={onSubmit} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {!sent ? (
        <div className="field">
          <label htmlFor="reset-email">{t('auth.email')}</label>
          <input
            id="reset-email"
            type="email"
            className="input"
            autoComplete="email"
            required
            readOnly={lockEmail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
      ) : (
        <>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            {t('auth.emailCodeSentInfo')}
          </p>
          <p style={{ textAlign: 'center', fontWeight: 600, color: 'var(--primary)' }}>{email.trim()}</p>
          <div className="field">
            <label htmlFor="reset-code">{t('auth.enterLoginCode')}</label>
            <input
              id="reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              className="input mono"
              style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 'var(--text-lg)' }}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              placeholder="00000000"
            />
          </div>
          <NewPasswordFields
            idPrefix="reset"
            password={password}
            confirm={confirm}
            checks={checks}
            onPassword={setPassword}
            onConfirm={setConfirm}
          />
        </>
      )}
      <button className="btn btn-primary btn-block" disabled={loading || (sent && !canConfirm)}>
        {loading ? <span className="spinner" /> : submitLabel}
      </button>
      {sent && (
        <button type="button" className="btn btn-secondary btn-block" onClick={sendCode} disabled={loading || cooldown > 0}>
          {resendLabel}
        </button>
      )}
      {showBack && (
        <button type="button" className="btn btn-ghost btn-block" onClick={onBackClick}>
          {t('common.back')}
        </button>
      )}
    </motion.form>
  )
}
