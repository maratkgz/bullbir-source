import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { useLang } from '../../../context/LangContext'
import { useToast } from '../../ui/Toast'
import NewPasswordFields from '../../auth/NewPasswordFields'
import PasswordResetForm from '../../auth/PasswordResetForm'
import { checkNewPassword, isNewPasswordValid } from '../../auth/passwordPolicy'

const EMPTY_FORM = { cur: '', next: '', confirm: '' }

/**
 * Security tab: change the password through our API, or — for Google / code-only accounts —
 * set one with the reset-by-code flow (a signed-in user can't open /forgot-password).
 * @param {{ hasPassword: boolean, email: string, onAuthError: (err: unknown) => void }} props
 */
export default function PasswordCard({ hasPassword, email, onAuthError }) {
  const { changePassword } = useAuth()
  const { t } = useLang()
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [settingPassword, setSettingPassword] = useState(false)

  const checks = checkNewPassword(form.next, form.confirm)
  const canSubmit = !!form.cur && isNewPasswordValid(checks)

  const submit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    try {
      await changePassword(form.cur, form.next)
      setForm(EMPTY_FORM)
      toast.success(t('profile.security.pwChanged'))
    } catch (err) {
      onAuthError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!hasPassword) {
    return (
      <div className="card prof-card-inner">
        <span className="prof-card-title">{t('profile.security.password')}</span>
        <p className="text-muted" style={{ fontSize: 'var(--text-sm)', margin: '8px 0 16px' }}>{t('profile.security.googleOnly')}</p>
        {settingPassword ? (
          <PasswordResetForm
            initialEmail={email}
            lockEmail
            onSuccess={() => setSettingPassword(false)}
            onCancel={() => setSettingPassword(false)}
          />
        ) : (
          <button className="btn btn-secondary" onClick={() => setSettingPassword(true)}>
            {t('profile.security.setPassword')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="card prof-card-inner">
      <span className="prof-card-title">{t('profile.security.password')}</span>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        <div className="field">
          <label htmlFor="pw-current">{t('profile.security.currentPw')}</label>
          <input
            id="pw-current"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={form.cur}
            onChange={(e) => setForm((p) => ({ ...p, cur: e.target.value }))}
          />
        </div>
        <NewPasswordFields
          idPrefix="pw"
          password={form.next}
          confirm={form.confirm}
          checks={checks}
          onPassword={(v) => setForm((p) => ({ ...p, next: v }))}
          onConfirm={(v) => setForm((p) => ({ ...p, confirm: v }))}
        />
        <button className="btn btn-primary" disabled={busy || !canSubmit}>
          {busy ? <span className="spinner" /> : t('profile.security.changePw')}
        </button>
      </form>
    </div>
  )
}
