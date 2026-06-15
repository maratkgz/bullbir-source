import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import BottomNav from './BottomNav'
import { useLang } from '../../context/LangContext'
import { NAV_ITEMS } from './navItems'
import './AppLayout.css'

const TITLE_MAP = {
  ...Object.fromEntries(NAV_ITEMS.map((i) => [i.to, i.key])),
  '/app/settings': 'nav.settings',
}

export default function AppLayout() {
  const { t } = useLang()
  const location = useLocation()
  const titleKey = TITLE_MAP[location.pathname] || 'appName'

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Navbar title={titleKey === 'appName' ? 'BullBir' : t(titleKey)} />
        <main className="app-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
