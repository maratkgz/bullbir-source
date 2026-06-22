import { motion } from 'framer-motion'

const COLORS = ['#5b4fcf', '#7c6ff7', '#ff6b35', '#ff9a6c', '#22c55e', '#f59e0b']

export default function Confetti({ count = 30 }) {
  const pieces = Array.from({ length: count }, (_, i) => i)
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 'var(--z-toast)', overflow: 'hidden' }}>
      {pieces.map((i) => {
        const left = Math.random() * 100
        const size = 7 + Math.random() * 8
        const delay = Math.random() * 0.4
        const rotate = Math.random() * 360
        return (
          <motion.span
            key={i}
            style={{
              position: 'absolute',
              top: '-20px',
              left: `${left}%`,
              width: size,
              height: size * 0.4,
              borderRadius: 2,
              background: COLORS[i % COLORS.length],
            }}
            initial={{ y: -20, opacity: 1, rotate }}
            animate={{ y: '105vh', opacity: [1, 1, 0], rotate: rotate + 360 }}
            transition={{ duration: 2, delay, ease: 'easeIn' }}
          />
        )
      })}
    </div>
  )
}
