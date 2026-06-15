import { motion } from 'framer-motion'
import Logo from './ui/Logo'
import { useLang } from '../context/LangContext'

function Particles() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {Array.from({ length: 18 }).map((_, i) => {
        const left = Math.random() * 100
        const size = 3 + Math.random() * 5
        const dur = 6 + Math.random() * 8
        return (
          <motion.span
            key={i}
            style={{ position: 'absolute', left: `${left}%`, bottom: -10, width: size, height: size, borderRadius: '50%', background: 'rgba(124,111,247,0.6)' }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: '-100vh', opacity: [0, 1, 0] }}
            transition={{ duration: dur, repeat: Infinity, delay: Math.random() * 5, ease: 'easeOut' }}
          />
        )
      })}
    </div>
  )
}

export default function Offline() {
  const { t } = useLang()
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-splash)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 'var(--space-5)',
        gap: 'var(--space-5)',
        background: 'var(--gradient-hero)',
        color: '#fff',
      }}
    >
      <Particles />
      <motion.div animate={{ y: [0, -16, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
        <Logo size={96} />
      </motion.div>
      <h1 style={{ color: '#fff' }}>{t('offline.title')}</h1>
      <p style={{ color: '#9ca3c4', maxWidth: 400 }}>{t('offline.subtitle')}</p>
      <motion.span
        style={{ width: 12, height: 12, borderRadius: '50%', background: '#7c6ff7' }}
        animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}
