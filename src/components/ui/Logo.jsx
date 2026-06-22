import { motion } from 'framer-motion'

export default function Logo({ size = 40, animated = false, className, style }) {
  const Wrap = animated ? motion.img : 'img'
  const hoverProps = animated
    ? { whileHover: { scale: 1.06, rotate: -2 }, transition: { type: 'spring', stiffness: 300, damping: 15 } }
    : {}
  return (
    <Wrap
      src="/logo.png"
      width={size}
      height={size}
      alt="BullBir"
      className={className}
      style={{ borderRadius: size * 0.26, objectFit: 'cover', display: 'block', ...style }}
      {...hoverProps}
    />
  )
}
