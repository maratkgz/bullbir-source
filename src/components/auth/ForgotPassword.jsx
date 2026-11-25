import { Link, useNavigate } from 'react-router-dom'
import { useLang } from '../../context/LangContext'
import AuthShell from './AuthShell'
import PasswordResetForm from './PasswordResetForm'

export default function ForgotPassword() {
  const { t } = useLang()
  const navigate = useNavigate()

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
      <PasswordResetForm onSuccess={() => navigate('/app/dashboard', { replace: true })} />
    </AuthShell>
  )
}
