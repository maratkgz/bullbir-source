import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useLang } from '../../context/LangContext'
import { usePWAInstall } from '../../hooks/usePWAInstall'
import { useToast } from '../ui/Toast'
import './Navbar.css'

function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme()
  return (
    <button className="nav-btn" onClick={toggleTheme} aria-label="theme">
      <motion.span key={isDark ? 'moon' : 'sun'} initial={{ rotate: -180, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }} style={{ display: 'flex' }}>
        {isDark ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        )}
      </motion.span>
    </button>
  )
}

function LangSwitcher() {
  const { lang, setLang, languages } = useLang()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])
  const current = languages.find((l) => l.code === lang)
  return (
    <div className="nav-dropdown" ref={ref}>
      <button className="nav-btn" onClick={() => setOpen((o) => !o)} aria-label="language">
        <span style={{ fontSize: 18 }}>{current?.flag}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="nav-menu" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            {languages.map((l) => (
              <button key={l.code} className={`nav-menu-item ${lang === l.code ? 'active' : ''}`} onClick={() => { setLang(l.code); setOpen(false) }}>
                <span style={{ fontSize: 18 }}>{l.flag}</span>
                {l.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function InstallButton() {
  const { canInstall, promptInstall, isIOS, showIosHint, dismissIosHint } = usePWAInstall()
  const { t } = useLang()
  const toast = useToast()

  if (canInstall) {
    return (
      <motion.button
        className="btn btn-secondary nav-install"
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25, duration: 0.3 }}
        onClick={async () => { await promptInstall() }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        {t('pwa.install')}
      </motion.button>
    )
  }

  if (isIOS && showIosHint) {
    return (
      <motion.button className="btn btn-ghost nav-install" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => { toast.info(t('pwa.iosHint'), 5000); dismissIosHint() }}>
        {t('pwa.install')}
      </motion.button>
    )
  }
  return null
}

function UserMenu() {
  const { user, profile, logout } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const name = profile?.displayName || user?.displayName || user?.email || 'U'
  const initial = name.charAt(0).toUpperCase()

  return (
    <div className="nav-dropdown" ref={ref}>
      <button className="nav-avatar" onClick={() => setOpen((o) => !o)} aria-label="account">
        {user?.photoURL ? <img src={user.photoURL} alt="" /> : initial}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="nav-menu nav-menu-right" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <div className="nav-menu-head">
              <strong>{profile?.displayName || user?.displayName || ''}</strong>
              <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>{user?.email || user?.phoneNumber}</span>
            </div>
            <hr className="divider" />
            <button className="nav-menu-item" onClick={() => { navigate('/app/settings'); setOpen(false) }}>{t('nav.settings')}</button>
            <button className="nav-menu-item danger" onClick={logout}>{t('auth.logout')}</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Navbar({ title }) {
  return (
    <header className="navbar">
      <div className="navbar-left">
        <h2 className="navbar-title">{title}</h2>
      </div>
      <div className="navbar-right">
        <InstallButton />
        <LangSwitcher />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
