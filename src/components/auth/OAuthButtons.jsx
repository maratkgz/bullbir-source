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

export default function OAuthButtons() {
  const { loginWithGoogle } = useAuth()
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
    </div>
  )
}
