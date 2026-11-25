import { Check } from 'lucide-react'
import { useLang } from '../../context/LangContext'
import Icon from '../ui/Icon'
import { PW_MAX } from './passwordPolicy'

function Rule({ ok, label }) {
  return (
    <span className={`pw-rule ${ok ? 'ok' : ''}`}>
      <Icon icon={Check} size={14} />
      {label}
    </span>
  )
}

/**
 * New password + confirmation with the Register checklist (same classes and texts).
 * @param {{ idPrefix: string, password: string, confirm: string,
 *   checks: { length: boolean, upper: boolean, number: boolean, match: boolean },
 *   onPassword: (v: string) => void, onConfirm: (v: string) => void }} props
 */
export default function NewPasswordFields({ idPrefix, password, confirm, checks, onPassword, onConfirm }) {
  const { t } = useLang()
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-new`}>{t('profile.security.newPw')}</label>
        <input
          id={`${idPrefix}-new`}
          type="password"
          className="input"
          autoComplete="new-password"
          required
          maxLength={PW_MAX}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-confirm`}>{t('profile.security.confirmPw')}</label>
        <input
          id={`${idPrefix}-confirm`}
          type="password"
          autoComplete="new-password"
          className={`input ${confirm && !checks.match ? 'error' : ''}`}
          required
          maxLength={PW_MAX}
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          placeholder="••••••••"
        />
      </div>
      <div className="pw-rules">
        <Rule ok={checks.length} label={t('pw.minLength')} />
        <Rule ok={checks.upper} label={t('pw.uppercase')} />
        <Rule ok={checks.number} label={t('pw.number')} />
        <Rule ok={checks.match} label={t('pw.match')} />
      </div>
    </>
  )
}
