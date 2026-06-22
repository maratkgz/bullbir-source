import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import AuthShell from './AuthShell'

export default function ForgotPassword() {
  const { resetPassword } = useAuth()
  const { t, tError } = useLang()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await resetPassword(email)
      setSent(true)
      toast.success(t('auth.resetSent'))
    } catch (err) {
      toast.error(tError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title={t('auth.resetPassword')}
      subtitle={t('auth.resetSubtitle')}
      footer={
        <Link to="/login" className="auth-link">
          {t('auth.backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'center' }}
        >
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <p className="text-secondary">{t('auth.resetSent')}</p>
        </motion.div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">{t('auth.email')}</label>
            <input id="email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <button className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <span className="spinner" /> : t('auth.sendResetLink')}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
