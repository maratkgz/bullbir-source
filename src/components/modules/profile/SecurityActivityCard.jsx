import { useState, useEffect, useCallback } from 'react'
import { TriangleAlert } from 'lucide-react'
import { useAuth } from '../../../context/AuthContext'
import { useLang } from '../../../context/LangContext'
import Icon from '../../ui/Icon'

const PAGE_SIZE = 20
const LOCALES = { en: 'en-US', kg: 'ky-KG', ru: 'ru-RU' }

// Same as DevicesCard's helper (kept local: exporting it would break react-refresh).
function formatWhen(value, lang) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(LOCALES[lang] || LOCALES.en, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const KNOWN_TYPES = new Set([
  'register', 'email_verified', 'login_success', 'login_failure', 'login_locked', 'logout',
  'logout_all', 'session_revoked', 'password_changed', 'password_reset', 'email_changed',
  'oauth_linked', 'account_deleted', 'breached_password_rejected', 'hibp_unavailable',
])

// Worth a second look if the user doesn't recognise them.
const SUSPICIOUS_TYPES = new Set(['login_failure', 'login_locked', 'password_reset', 'email_changed', 'oauth_linked'])

const SUSPICIOUS_STYLE = { borderLeft: '3px solid var(--warning)', background: 'var(--warning-light)' }

/** Security tab: the latest security events (server returns up to 50), 20 at a time. */
export default function SecurityActivityCard() {
  const { listSecurityEvents } = useAuth()
  const { t, lang } = useLang()
  const [events, setEvents] = useState([])
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [visible, setVisible] = useState(PAGE_SIZE)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const list = await listSecurityEvents()
      setEvents(Array.isArray(list) ? list : [])
      setVisible(PAGE_SIZE)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [listSecurityEvents])

  useEffect(() => { load() }, [load])

  const label = (type) => t(`profile.activity.type.${KNOWN_TYPES.has(type) ? type : 'unknown'}`)

  return (
    <div className="card prof-card-inner">
      <span className="prof-card-title">{t('profile.activity.title')}</span>
      {status === 'loading' && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}><span className="spinner" /></div>
      )}
      {status === 'error' && (
        <div style={{ marginTop: 12 }}>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 12 }}>{t('profile.activity.loadError')}</p>
          <button className="btn btn-secondary btn-sm" onClick={load}>{t('common.retry')}</button>
        </div>
      )}
      {status === 'ready' && events.length === 0 && (
        <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 12 }}>{t('profile.activity.empty')}</p>
      )}
      {status === 'ready' && events.length > 0 && (
        <>
          <div className="prof-provider-list">
            {events.slice(0, visible).map((ev, i) => {
              const suspicious = SUSPICIOUS_TYPES.has(ev.type)
              const meta = [formatWhen(ev.at, lang), ev.device, ev.ipPrefix && t('profile.devices.network', { ip: ev.ipPrefix })]
                .filter(Boolean)
                .join(' · ')
              return (
                // Events have no id; the list is append-only and newest-first, so index + fields is stable enough.
                <div key={`${i}-${ev.type}-${ev.at}`} className="prof-provider" style={suspicious ? SUSPICIOUS_STYLE : undefined}>
                  {suspicious && (
                    <span style={{ color: 'var(--warning)', display: 'inline-flex' }}>
                      <Icon icon={TriangleAlert} size={18} label={t('profile.activity.suspicious')} />
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 500 }}>{label(ev.type)}</span>
                    <span className="prof-field-hint">{meta}</span>
                  </div>
                </div>
              )
            })}
          </div>
          {events.length > visible && (
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              {t('profile.activity.showMore')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
