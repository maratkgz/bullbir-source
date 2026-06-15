import { motion } from 'framer-motion'
import Logo from './Logo'

export default function Splash({ onDone }) {
  return (
    <motion.div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-splash)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-5)',
        background: 'var(--gradient-hero)',
      }}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onAnimationComplete={onDone}
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18, duration: 0.6 }}
      >
        <Logo size={120} />
      </motion.div>
      <motion.h1
        style={{ color: '#fff', fontSize: 'var(--text-2xl)', letterSpacing: '-0.02em' }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.4 }}
      >
        BullBir
      </motion.h1>
      <motion.span
        className="spinner"
        style={{ color: '#7c6ff7' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      />
    </motion.div>
  )
}
