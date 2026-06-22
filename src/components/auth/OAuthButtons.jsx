import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 0 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44c11 0 20-8.9 20-20 0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.6 5.1A20 20 0 0 0 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C39.6 35.6 44 30.4 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.9c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.8-2.2c.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.9zM14.1 6.2c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 0 2-.5 2.7-1.3z" />
    </svg>
  )
}

export default function OAuthButtons() {
  const { loginWithGoogle, loginWithApple } = useAuth()
  const { t, tError } = useLang()
  const toast = useToast()
  const [busy, setBusy] = useState(null)

  const run = async (provider, fn) => {
    setBusy(provider)
    try {
      await fn()
    } catch (err) {
      toast.error(tError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="oauth-row">
      <button
        className="oauth-btn"
        disabled={!!busy}
        onClick={() => run('google', loginWithGoogle)}
      >
        {busy === 'google' ? <span className="spinner" /> : <GoogleIcon />}
        <span>{t('auth.google')}</span>
      </button>
      <button
        className="oauth-btn oauth-apple"
        disabled={!!busy}
        onClick={() => run('apple', loginWithApple)}
      >
        {busy === 'apple' ? <span className="spinner" /> : <AppleIcon />}
        <span>{t('auth.apple')}</span>
      </button>
    </div>
  )
}
