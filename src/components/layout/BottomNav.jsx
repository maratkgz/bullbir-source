import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BOTTOM_NAV_ITEMS } from './navItems'
import { useLang } from '../../context/LangContext'
import './BottomNav.css'

export default function BottomNav() {
  const { t } = useLang()
  const location = useLocation()

  return (
    <nav className="bottom-nav">
      {BOTTOM_NAV_ITEMS.map((item) => {
        const active = location.pathname === item.to
        return (
          <NavLink key={item.to} to={item.to} className={`bottom-link ${active ? 'active' : ''}`}>
            {active && (
              <motion.span layoutId="bottom-indicator" className="bottom-indicator" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
            )}
            <span className="bottom-icon">{item.icon}</span>
            <span className="bottom-label">{t(item.key)}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
