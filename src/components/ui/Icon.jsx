import { motion } from 'framer-motion'

export const ICON_SIZE = 20
export const ICON_STROKE = 1.75
const HOVER = { scale: 1.1 }
const TAP = { scale: 0.9 }

/**
 * Single entry point for icons (Lucide, thin Notion-like strokes, colour = currentColor).
 * Pass the icon component itself so the bundle only contains icons that are used:
 *   import { Plus } from 'lucide-react'
 *   <Icon icon={Plus} />
 * Decorative by default (aria-hidden). Pass `label` when the icon alone carries meaning.
 */
export default function Icon({
  icon: LucideIcon,
  size = ICON_SIZE,
  strokeWidth = ICON_STROKE,
  className,
  animated = false,
  label,
  style,
}) {
  if (!LucideIcon) return null
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  const svg = (
    <LucideIcon
      size={size}
      strokeWidth={strokeWidth}
      color="currentColor"
      className={animated ? undefined : className}
      style={animated ? undefined : style}
      focusable="false"
      {...(animated ? { 'aria-hidden': true } : a11y)}
    />
  )
  if (!animated) return svg
  return (
    <motion.span
      className={className}
      style={{ display: 'inline-flex', ...style }}
      whileHover={HOVER}
      whileTap={TAP}
      {...a11y}
    >
      {svg}
    </motion.span>
  )
}
