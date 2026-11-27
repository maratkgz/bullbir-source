import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'

/**
 * Stat tile that links to its module. The whole tile is the link (≥44px target).
 * `value` is shown on one line with an ellipsis; the full text stays in `title`.
 */
export default function StatCard({ icon, label, value, sub, color = 'var(--primary)', to, variants }) {
  const text = String(value)
  return (
    <motion.div className="dash-stat-cell" variants={variants}>
      <Link to={to} className="dash-stat-card card" style={{ '--stat-color': color }}>
        <span className="dash-stat-inner">
          <span className="dash-stat-icon" aria-hidden="true">{icon}</span>
          <span className="dash-stat-body">
            <span className="dash-stat-value" title={text}>{text}</span>
            <span className="dash-stat-label">{label}</span>
            {sub && <span className="dash-stat-sub">{sub}</span>}
          </span>
        </span>
      </Link>
    </motion.div>
  )
}
