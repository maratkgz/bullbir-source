import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import { useToast } from '../ui/Toast'
import AuthShell from './AuthShell'

export default function VerifyEmail() {
  const { user, checkVerified, resendVerification, logout, onboardingDone } = useAuth()
  const { t, tError } = useLang()
  const toast = useToast()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const id = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  // Poll for verification automatically.
  useEffect(() => {
    const id = setInterval(async () => {
      const ok = await checkVerified()
      if (ok) {
        clearInterval(id)
        navigate(onboardingDone ? '/app/dashboard' : '/onboarding')
      }
    }, 4000)
    return () => clearInterval(id)
  }, [checkVerified, navigate, onboardingDone])

  const onCheck = async () => {
    setChecking(true)
    try {
      const ok = await checkVerified()
      if (ok) navigate(onboardingDone ? '/app/dashboard' : '/onboarding')
      else toast.info(t('auth.notVerifiedYet'))
    } finally {
      setChecking(false)
    }
  }

  const onResend = async () => {
    try {
      await resendVerification()
      toast.success(t('auth.verificationSent'))
      setCooldown(45)
    } catch (err) {
      toast.error(tError(err))
    }
  }

  return (
    <AuthShell title={t('auth.verifyEmail')} subtitle={t('auth.verifyEmailSubtitle')}>
      <motion.div
        className="auth-form"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <p style={{ textAlign: 'center', fontWeight: 600, color: 'var(--primary)' }}>{user?.email}</p>
        <button className="btn btn-primary btn-block" onClick={onCheck} disabled={checking}>
          {checking ? <span className="spinner" /> : t('auth.checkedVerified')}
        </button>
        <button className="btn btn-secondary btn-block" onClick={onResend} disabled={cooldown > 0}>
          {cooldown > 0 ? `${t('auth.resendVerification')} (${cooldown})` : t('auth.resendVerification')}
        </button>
        <button className="btn btn-ghost btn-block" onClick={logout}>
          {t('auth.logout')}
        </button>
      </motion.div>
    </AuthShell>
  )
}
