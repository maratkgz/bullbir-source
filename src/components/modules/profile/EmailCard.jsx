import { useState, useEffect } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { useLang } from '../../../context/LangContext'
import { useToast } from '../../ui/Toast'

// Same code UX as EmailCodeLogin: 8 digits, resend every 60 s.
const RESEND_COOLDOWN_S = 60
const CODE_LENGTH = 8

/**
 * Security tab: change the sign-in email. new address + current password → 8-digit code
 * mailed to the NEW address → confirm. Passwordless accounts must set a password first.
 * @param {{ email: string, hasPassword: boolean, onAuthError: (err: unknown) => void }} props
 */
export default function EmailCard({ email, hasPassword, onAuthError }) {
  const { requestEmailChange, confirmEmailChange } = useAuth()
  const { t } = useLang()
  const toast = useToast()
  const [step, setStep] = useState('idle') // 'idle' | 'form' | 'code'
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const id = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  const reset = () => {
    setStep('idle')
    setNewEmail('')
    setPassword('')
    setCode('')
  }

  const run = async (action) => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      onAuthError(err)
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () => run(async () => {
    await requestEmailChange(newEmail.trim(), password)
    setStep('code')
    setCooldown(RESEND_COOLDOWN_S)
  })

  const confirm = () => run(async () => {
    try {
      await confirmEmailChange(newEmail.trim(), code)
    } catch (err) {
      setCode('')
      throw err
    }
    toast.success(t('profile.email.changed'))
    reset()
  })

  const onSubmit = (e) => {
    e.preventDefault()
    if (step === 'code') confirm()
    else sendCode()
  }

  const canSend = !!newEmail.trim() && !!password
  const resendLabel = cooldown > 0 ? `${t('auth.resendCode')} (${cooldown})` : t('auth.resendCode')

  return (
    <div className="card prof-card-inner">
      <span className="prof-card-title">{t('profile.field.email')}</span>
      {step === 'idle' ? (
        <div className="prof-field">
          <div className="prof-field-body">
            <span className="prof-fval">{email || '—'}</span>
            {hasPassword && (
              <button className="btn btn-secondary btn-sm" onClick={() => setStep('form')}>
                {t('profile.email.change')}
              </button>
            )}
          </div>
          {!hasPassword && <span className="prof-field-hint">{t('profile.security.needPassword')}</span>}
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {step === 'form' ? (
            <>
              <div className="field">
                <label htmlFor="email-new">{t('profile.email.newEmail')}</label>
                <input
                  id="email-new"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="field">
                <label htmlFor="email-pw">{t('profile.security.currentPw')}</label>
                <input
                  id="email-pw"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{t('profile.email.codeSentTo')}</p>
              <p style={{ fontWeight: 600, color: 'var(--primary)' }}>{newEmail.trim()}</p>
              <div className="field">
                <label htmlFor="email-code">{t('auth.enterLoginCode')}</label>
                <input
                  id="email-code"
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
            </>
          )}
          <button
            className="btn btn-primary"
            disabled={busy || (step === 'form' ? !canSend : code.length !== CODE_LENGTH)}
          >
            {busy ? <span className="spinner" /> : t(step === 'form' ? 'auth.sendCode' : 'profile.email.confirmChange')}
          </button>
          {step === 'code' && (
            <button type="button" className="btn btn-secondary" onClick={sendCode} disabled={busy || cooldown > 0}>
              {resendLabel}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={step === 'code' ? () => { setStep('form'); setCode('') } : reset}>
            {step === 'code' ? t('common.back') : t('common.cancel')}
          </button>
        </form>
      )}
    </div>
  )
}
