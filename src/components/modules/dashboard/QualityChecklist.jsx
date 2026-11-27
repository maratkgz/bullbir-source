import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Check, Sun } from 'lucide-react'
import { useLang } from '../../../context/LangContext'
import Icon from '../../ui/Icon'
import { DIRECTION_COLORS } from '../mandala/mandalaModel'
import './today.css'

/**
 * Morning checklist of the active mandala's quality items. Ticks live in mandala.checks[todayKey].
 * @param {{ qualities: Array<{ d: number, i: number, text: string }>, checked: string[], onToggle: (key: string) => void }} props
 */
export default function QualityChecklist({ qualities, checked, onToggle }) {
  const { t } = useLang()
  const reduce = useReducedMotion()
  if (!qualities.length) return null
  const done = qualities.filter((q) => checked.includes(`${q.d}-${q.i}`)).length

  return (
    <section className="card" aria-labelledby="qual-title">
      <div className="today-head">
        <h3 id="qual-title"><Icon icon={Sun} size={18} /> {t('today.qualTitle')}</h3>
        <span className="today-meta">{done}/{qualities.length}</span>
      </div>
      <p className="qual-hint">{t('today.qualHint')}</p>
      <ul className="today-list">
        {qualities.map((q) => {
          const key = `${q.d}-${q.i}`
          const on = checked.includes(key)
          return (
            <li key={key}>
              <button
                type="button"
                className={`qual-row ${on ? 'is-on' : ''}`}
                role="checkbox"
                aria-checked={on}
                aria-label={t('today.qualToggle', { text: q.text })}
                onClick={() => onToggle(key)}
              >
                <span className={`today-check today-check-sm ${on ? 'is-on' : ''}`} aria-hidden="true">
                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.span
                        key="tick"
                        initial={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }}
                        animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={reduce ? { duration: 0.1 } : { type: 'spring', stiffness: 500, damping: 24 }}
                        style={{ display: 'grid' }}
                      >
                        <Icon icon={Check} size={13} strokeWidth={3} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="today-dot" style={{ background: DIRECTION_COLORS[q.d] }} aria-hidden="true" />
                <span className="qual-text">{q.text}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
