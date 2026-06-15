import { useId } from 'react'
import { motion } from 'framer-motion'

// BullBir mark — an upward arrow ("rise" / progress) that also reads as "1"
// (Bir = "one"). Minimal geometric mark on a gradient squircle.
// Size is controlled via the `size` prop; colors come from the gradient.
export default function Logo({ size = 40, animated = false, className, style }) {
  const Wrap = animated ? motion.svg : 'svg'
  const uid = useId().replace(/[:]/g, '')
  const gid = `bb-grad-${uid}`
  const sid = `bb-shine-${uid}`
  const hoverProps = animated
    ? { whileHover: { scale: 1.06, rotate: -2 }, transition: { type: 'spring', stiffness: 300, damping: 15 } }
    : {}
  return (
    <Wrap
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="BullBir"
      className={className}
      style={style}
      {...hoverProps}
    >
      <defs>
        <linearGradient id={gid} x1="10" y1="6" x2="92" y2="98" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b7cff" />
          <stop offset="0.55" stopColor="#5b4fcf" />
          <stop offset="1" stopColor="#3f33a8" />
        </linearGradient>
        <linearGradient id={sid} x1="50" y1="4" x2="50" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="26" fill={`url(#${gid})`} />
      <rect width="100" height="54" rx="26" fill={`url(#${sid})`} />
      <path d="M28 60L50 30L72 60" stroke="#ffffff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 45V74" stroke="#ffffff" strokeWidth="11" strokeLinecap="round" />
    </Wrap>
  )
}
