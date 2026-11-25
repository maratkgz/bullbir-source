import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'

// Login codes are 8 digits (registration codes stay 6); the server allows a resend every 60 s.
const RESEND_COOLDOWN_S = 60
const LOGIN_CODE_LENGTH = 8

/**
 * Sign in with a one-time code mailed to the address (stage 4). Two steps: email → code.
 * The code is bound to this browser by an HttpOnly cookie set on request.
 * @param {{ initialEmail: string, onBack: () => void, onSuccess: () => void, fail: (err: unknown) => void }} props
 */
export default function EmailCodeLogin({ initialEmail, onBack, onSuccess, fail }) {
  const { requestLoginCode, loginWithCode } = useAuth()
  const { t } = useLang()
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const id = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  const codeComplete = code.length === LOGIN_CODE_LENGTH

  const sendCode = async () => {
    setLoading(true)
    try {
      await requestLoginCode(email.trim())
      setSent(true)
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      fail(err)
    } finally {
      setLoading(false)
    }
  }

  const verify = async () => {
    if (!codeComplete) return
    setLoading(true)
    try {
      await loginWithCode(email.trim(), code)
      onSuccess()
    } catch (err) {
      setCode('')
      fail(err)
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = (e) => {
    e.preventDefault()
    if (sent) verify()
    else sendCode()
  }

  const onBackClick = () => {
    if (!sent) {
      onBack()
      return
    }
    setSent(false)
    setCode('')
  }

  const submitLabel = sent ? t('auth.login') : t('auth.sendCode')
  const resendLabel = cooldown > 0 ? `${t('auth.resendCode')} (${cooldown})` : t('auth.resendCode')

  return (
    <motion.form
      key="email-code"
      className="auth-form"
      onSubmit={onSubmit}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {!sent ? (
        <div className="field">
          <label htmlFor="otp-email">{t('auth.email')}</label>
          <input
            id="otp-email"
            type="email"
            className="input"
            autoComplete="email"
            required
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
            <label htmlFor="otp-code">{t('auth.enterLoginCode')}</label>
            <input
              id="otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={LOGIN_CODE_LENGTH}
              className="input mono"
              style={{ textAlign: 'center', letterSpacing: '0.4em', fontSize: 'var(--text-lg)' }}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, LOGIN_CODE_LENGTH))}
              placeholder="00000000"
            />
          </div>
        </>
      )}
      <button className="btn btn-primary btn-block" disabled={loading || (sent && !codeComplete)}>
        {loading ? <span className="spinner" /> : submitLabel}
      </button>
      {sent && (
        <button type="button" className="btn btn-secondary btn-block" onClick={sendCode} disabled={loading || cooldown > 0}>
          {resendLabel}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-block" onClick={onBackClick}>
        {t('common.back')}
      </button>
    </motion.form>
  )
}
