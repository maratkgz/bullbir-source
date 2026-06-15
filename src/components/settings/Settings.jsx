import { useState } from 'react'
import { motion } from 'framer-motion'
import { deleteUser } from 'firebase/auth'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useLang } from '../../context/LangContext'
import { usePWAInstall } from '../../hooks/usePWAInstall'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'

const APP_VERSION = '1.0.0'

export default function Settings() {
  const { user, profile, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const { lang, setLang, languages, t, tError } = useLang()
  const { canInstall, installed, promptInstall } = usePWAInstall()
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const name = profile?.displayName || user?.displayName || ''
  const initial = (name || user?.email || 'U').charAt(0).toUpperCase()

  const onDelete = async () => {
    try {
      if (user) await deleteUser(user)
      toast.success(t('common.done'))
    } catch (err) {
      toast.error(tError(err))
    } finally {
      setConfirmDelete(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ maxWidth: 680, margin: '0 auto' }}>
      <div className="card settings-section">
        <span className="section-title">{t('set.account')}</span>
        <div className="flex items-center gap-4">
          <div className="nav-avatar" style={{ width: 56, height: 56, fontSize: 22 }}>
            {user?.photoURL ? <img src={user.photoURL} alt="" /> : initial}
          </div>
          <div>
            <strong style={{ fontSize: 'var(--text-md)' }}>{name || '—'}</strong>
            <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{user?.email || user?.phoneNumber}</p>
          </div>
        </div>
      </div>

      <div className="card settings-section">
        <span className="section-title">{t('set.appearance')}</span>
        <div className="settings-row">
          <label>{t('set.theme')}</label>
          <div className="seg">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>{t('onb.light')}</button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>{t('onb.dark')}</button>
          </div>
        </div>
        <div className="settings-row">
          <label>{t('set.language')}</label>
          <div className="seg">
            {languages.map((l) => (
              <button key={l.code} className={lang === l.code ? 'active' : ''} onClick={() => setLang(l.code)}>{l.code.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card settings-section">
        <span className="section-title">{t('set.about')}</span>
        <div className="settings-row">
          <label>{t('set.installApp')}</label>
          {installed ? (
            <span className="badge" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--success)' }}>{t('pwa.installed')}</span>
          ) : canInstall ? (
            <button className="btn btn-secondary" onClick={promptInstall}>{t('pwa.install')}</button>
          ) : (
            <span className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('pwa.iosHint')}</span>
          )}
        </div>
        <div className="settings-row">
          <label>{t('set.version')}</label>
          <span className="mono text-muted">{APP_VERSION}</span>
        </div>
      </div>

      <div className="card settings-section">
        <button className="btn btn-secondary btn-block" onClick={logout} style={{ marginBottom: 'var(--space-3)' }}>{t('set.signOut')}</button>
        <button className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>{t('set.deleteAccount')}</button>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('set.deleteAccount')}>
        <p className="text-secondary">{t('set.deleteAccount')}?</p>
        <div className="flex gap-3 justify-between">
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
          <button className="btn btn-danger" onClick={onDelete}>{t('common.delete')}</button>
        </div>
      </Modal>
    </motion.div>
  )
}
