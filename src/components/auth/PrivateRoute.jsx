import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { CloudOff } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import Icon from '../ui/Icon'
import Splash from '../ui/Splash'

/**
 * Shown instead of redirecting when we can't tell who is signed in (server unreachable on start)
 * or the profile could not be loaded: an existing user must never land on /login or /onboarding
 * just because the network failed.
 */
export function SessionUnavailable() {
  const { retrySession, logout } = useAuth()
  const { t } = useLang()
  const [busy, setBusy] = useState(false)

  const retry = async () => {
    setBusy(true)
    try {
      await retrySession()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-5)',
      }}
    >
      <div
        className="card"
        role="alert"
        style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)', textAlign: 'center' }}
      >
        <Icon icon={CloudOff} size={32} />
        <h2>{t('auth.sessionUnavailable.title')}</h2>
        <p className="text-secondary">{t('auth.sessionUnavailable.body')}</p>
        <button type="button" className="btn btn-primary btn-block" onClick={retry} disabled={busy}>
          {busy ? <span className="spinner" /> : t('common.retry')}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={logout}>
          {t('auth.logout')}
        </button>
      </div>
    </div>
  )
}

export default function PrivateRoute({ children }) {
  const { user, loading, sessionUnknown, isVerified, profileStatus, onboardingDone } = useAuth()
  const location = useLocation()

  if (loading) return <Splash />
  if (sessionUnknown) return <SessionUnavailable />

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (!isVerified) return <Navigate to="/verify-email" replace />
  if (profileStatus === 'idle' || profileStatus === 'loading') return <Splash />
  if (profileStatus === 'error') return <SessionUnavailable />
  if (!onboardingDone) return <Navigate to="/onboarding" replace />

  return children
}
