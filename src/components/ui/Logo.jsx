import { motion } from 'framer-motion'

// BullBir brand mark — the "BULL 1" logo. Rendered as a rounded image so it
// works on light/dark backgrounds. Size is controlled via the `size` prop.
// `/logo.png` is served from the public/ directory.
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
