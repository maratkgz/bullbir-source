import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV_ITEMS } from './navItems'
import { useLang } from '../../context/LangContext'
import Logo from '../ui/Logo'
import './Sidebar.css'

export default function Sidebar() {
  const { t } = useLang()
  const location = useLocation()

  return (
    <aside className="sidebar">
      <NavLink to="/app/dashboard" className="sidebar-brand">
        <Logo size={32} animated />
        <span className="sidebar-brand-name">BullBir</span>
      </NavLink>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.to
          return (
            <NavLink key={item.to} to={item.to} className={`sidebar-link ${active ? 'active' : ''}`}>
              {active && (
                <motion.span layoutId="sidebar-indicator" className="sidebar-indicator" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
              )}
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{t(item.key)}</span>
            </NavLink>
          )
        })}
      </nav>

      <NavLink to="/app/settings" className={`sidebar-link ${location.pathname === '/app/settings' ? 'active' : ''}`}>
        <span className="sidebar-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        </span>
        <span className="sidebar-label">{t('nav.settings')}</span>
      </NavLink>
    </aside>
  )
}
