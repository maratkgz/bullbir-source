import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV_ITEMS } from './navItems'
import { useLang } from '../../context/LangContext'
import Logo from '../ui/Logo'
import { Settings } from 'lucide-react'
import Icon from '../ui/Icon'
import './Sidebar.css'

export default function Sidebar() {
  const { t } = useLang()
  const location = useLocation()

  return (
    <aside className="sidebar">
      <NavLink to="/app/dashboard" className="sidebar-brand" aria-label="BullBir">
        <Logo size={32} animated />
        <span className="sidebar-brand-name">BullBir</span>
      </NavLink>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.to
          return (
            <NavLink key={item.to} to={item.to} className={`sidebar-link ${active ? 'active' : ''}`}
              aria-label={t(item.key)} title={t(item.key)}>
              {active && (
                <motion.span layoutId="sidebar-indicator" className="sidebar-indicator" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
              )}
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{t(item.key)}</span>
            </NavLink>
          )
        })}
      </nav>

      <NavLink to="/app/settings" className={`sidebar-link ${location.pathname === '/app/settings' ? 'active' : ''}`}
        aria-label={t('nav.settings')} title={t('nav.settings')}>
        <span className="sidebar-icon">
          <Icon icon={Settings} size={22} />
        </span>
        <span className="sidebar-label">{t('nav.settings')}</span>
      </NavLink>
    </aside>
  )
}
