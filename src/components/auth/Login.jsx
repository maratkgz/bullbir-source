import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import AuthShell from './AuthShell'
import OAuthButtons from './OAuthButtons'
import EmailCodeLogin from './EmailCodeLogin'
import { Eye, EyeOff } from 'lucide-react'
import Icon from '../ui/Icon'

// Error codes the server's Google callback may append as /login?error=<code>.
const OAUTH_ERRORS = new Set([
  'oauth_cancelled',
  'oauth_failed',
  'oauth_email_unverified',
  'oauth_email_missing',
  'oauth_link_unverified',
  'oauth_account_exists',
  'oauth_unavailable',
])

function EyeButton({ shown, onClick }) {
  return (
    <button type="button" className="input-eye" onClick={onClick} tabIndex={-1} aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}>
      {shown ? (
        <Icon icon={Eye} />
      ) : (
        <Icon icon={EyeOff} />
      )}
    </button>
  )
}

export default function Login() {
  const { login } = useAuth()
  const { t, tError } = useLang()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const oauthErrorShown = useRef(false)

  const [mode, setMode] = useState('email') // 'email' | 'code'
  // Too many wrong passwords: point to the email-code sign-in (works during a lockout).
  const [lockedOut, setLockedOut] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(false)

  const fail = (err) => {
    toast.error(tError(err))
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  // Google sign-in came back with ?error=oauth_*: show it once, then drop the param so a
  // reload doesn't repeat it.
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('error')
    if (!code || !code.startsWith('oauth_') || oauthErrorShown.current) return
    oauthErrorShown.current = true
    fail(OAUTH_ERRORS.has(code) ? code : 'oauth_failed')
    navigate(location.pathname, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run for the incoming URL only
  }, [location.search])

  const onEmailSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login({ email, password })
      navigate('/app/dashboard')
    } catch (err) {
      if (err.code === 'auth/email-unverified') {
        toast.success(tError(err))
        navigate('/verify-email')
        return
      }
      if (err.code === 'auth/too-many-requests') setLockedOut(true)
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
              {lockedOut && (
                <p style={{ textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  {t('auth.lockedOutHint')}{' '}
                  <button type="button" className="auth-link" style={{ padding: 0 }} onClick={() => setMode('code')}>
                    {t('auth.useEmailCode')}
                  </button>
                </p>
              )}
              <button type="button" className="btn btn-ghost btn-block" onClick={() => setMode('code')}>
                {t('auth.useEmailCode')}
              </button>
            </motion.form>
          ) : (
            <EmailCodeLogin
              key="code"
              initialEmail={email}
              onBack={() => setMode('email')}
              onSuccess={() => navigate('/app/dashboard')}
              fail={fail}
            />
          )}
        </AnimatePresence>
      </motion.div>

      <div className="auth-divider">{t('auth.continueWith')}</div>
      <OAuthButtons />
    </AuthShell>
  )
}
