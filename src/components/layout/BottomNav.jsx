import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { BOTTOM_NAV_ITEMS, NAV_ITEMS } from './navItems'
import { useLang } from '../../context/LangContext'
import './BottomNav.css'

const MORE_ITEMS = NAV_ITEMS.filter(
  (item) => !BOTTOM_NAV_ITEMS.slice(0, 4).some((b) => b.to === item.to)
)

export default function BottomNav() {
  const { t } = useLang()
  const location = useLocation()
  const navigate = useNavigate()
  const [showMore, setShowMore] = useState(false)

  const mainItems = BOTTOM_NAV_ITEMS.slice(0, 4)

  return (
    <>
      <nav className="bottom-nav">
        {mainItems.map((item) => {
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

        <button
          className={`bottom-link ${showMore ? 'active' : ''}`}
          onClick={() => setShowMore((v) => !v)}
        >
          <span className="bottom-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
            </svg>
          </span>
          <span className="bottom-label">{t('nav.more')}</span>
        </button>
      </nav>

      <AnimatePresence>
        {showMore && (
          <>
            <motion.div
              className="more-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMore(false)}
            />
            <motion.div
              className="more-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            >
              <div className="more-handle" />
              <div className="more-grid">
                {MORE_ITEMS.map((item) => {
                  const active = location.pathname === item.to
                  return (
                    <button
                      key={item.to}
                      className={`more-item ${active ? 'active' : ''}`}
                      onClick={() => { navigate(item.to); setShowMore(false) }}
                    >
                      <span className="more-icon">{item.icon}</span>
                      <span className="more-label">{t(item.key)}</span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
