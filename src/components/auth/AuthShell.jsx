import { motion } from 'framer-motion'
import Logo from '../ui/Logo'
import { useLang } from '../../context/LangContext'
import './Auth.css'

function Blobs() {
  const blobs = ['b1', 'b2', 'b3', 'b4']
  return (
    <div className="auth-blobs">
      {blobs.map((b, i) => (
        <motion.span
          key={b}
          className={`auth-blob ${b}`}
          animate={{ x: [0, 30, -20, 0], y: [0, -25, 20, 0] }}
          transition={{ duration: 25 + i * 6, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

export default function AuthShell({ title, subtitle, children, footer }) {
  const { lang, setLang, languages } = useLang()
  return (
    <div className="auth-page">
      <Blobs />
      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="auth-toprow">
          <div className="lang-mini">
            {languages.map((l) => (
              <button
                key={l.code}
                className={lang === l.code ? 'active' : ''}
                onClick={() => setLang(l.code)}
              >
                {l.code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <Logo size={56} animated className="auth-logo" />
        <div className="auth-head">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
        {footer && <div className="auth-foot">{footer}</div>}
      </motion.div>
    </div>
  )
}
