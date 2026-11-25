import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { useLang } from '../../../context/LangContext'
import { useToast } from '../../ui/Toast'

const LOCALES = { en: 'en-US', kg: 'ky-KG', ru: 'ru-RU' }

/**
 * Formats an ISO date (or millis) for the current UI language; '—' when missing/invalid.
 * @param {string|number|null|undefined} value
 * @param {string} lang
 * @returns {string}
 */
function formatWhen(value, lang) {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(LOCALES[lang] || LOCALES.en, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Security tab: "My devices" — active sessions, sign one out, or sign out everywhere.
 * @param {{ onAuthError: (err: unknown) => void }} props
 */
export default function DevicesCard({ onAuthError }) {
  const { listSessions, revokeSession, logoutAll } = useAuth()
  const { t, lang } = useLang()
  const toast = useToast()
  const [sessions, setSessions] = useState([])
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const list = await listSessions()
      setSessions(Array.isArray(list) ? list : [])
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [listSessions])

  useEffect(() => { load() }, [load])

  const deviceName = (s) => s.device || t('profile.devices.unknown')

  const revoke = async (s) => {
    if (!window.confirm(t('profile.devices.confirmRevoke', { device: deviceName(s) }))) return
    setBusyId(s.id)
    try {
      await revokeSession(s.id)
      toast.success(t('profile.devices.revoked'))
      await load()
    } catch (err) {
      onAuthError(err)
    } finally {
      setBusyId(null)
    }
  }

  const revokeAll = async () => {
    if (!window.confirm(t('profile.devices.confirmAll'))) return
    setBusyId('*')
    try {
      await logoutAll() // signs this browser out too — the auth gate redirects to /login
    } catch (err) {
      onAuthError(err)
      setBusyId(null)
    }
  }

  return (
    <div className="card prof-card-inner">
      <span className="prof-card-title">{t('profile.devices.title')}</span>
      {status === 'loading' && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}><span className="spinner" /></div>
      )}
      {status === 'error' && (
        <div style={{ marginTop: 12 }}>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 12 }}>{t('profile.devices.loadError')}</p>
          <button className="btn btn-secondary btn-sm" onClick={load}>{t('common.retry')}</button>
        </div>
      )}
      {status === 'ready' && sessions.length === 0 && (
        <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 12 }}>{t('profile.devices.empty')}</p>
      )}
      {status === 'ready' && sessions.length > 0 && (
        <>
          <div className="prof-provider-list">
            {sessions.map((s) => (
              <div key={s.id} className="prof-provider">
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 500 }}>
                    {deviceName(s)}{' '}
                    {s.current && <span className="prof-badge success">{t('profile.devices.thisDevice')}</span>}
                  </span>
                  <span className="prof-field-hint">
                    {t('profile.devices.lastActive', { time: formatWhen(s.lastSeenAt || s.createdAt, lang) })}
                    {s.ipPrefix ? ` · ${t('profile.devices.network', { ip: s.ipPrefix })}` : ''}
                  </span>
                </div>
                {!s.current && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => revoke(s)}
                    disabled={busyId !== null}
                    aria-label={t('profile.devices.signOutAria', { device: deviceName(s) })}
                  >
                    {busyId === s.id ? <span className="spinner" /> : t('profile.devices.signOut')}
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={revokeAll} disabled={busyId !== null}>
            {busyId === '*' ? <span className="spinner" /> : t('profile.devices.signOutAll')}
          </button>
        </>
      )}
    </div>
  )
}
