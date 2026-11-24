import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import Logo from '../ui/Logo'
import { useLang } from '../../context/LangContext'
import { ArrowLeft, Flame, Grid3x3, ListChecks, Wallet } from 'lucide-react'
import Icon from '../ui/Icon'
import './Auth.css'

const BRAND_FEATS = [
  { icon: ListChecks, text: 'Tasks, habits & goals in one place' },
  { icon: Flame, text: 'Build streaks that actually stick' },
  { icon: Wallet, text: 'Track your finances effortlessly' },
  { icon: Grid3x3, text: 'Mandala 9×9: one goal, 64 concrete actions' },
]

const BRAND_FEATS_RU = [
  { icon: ListChecks, text: 'Задачи, привычки и цели в одном месте' },
  { icon: Flame, text: 'Серии, которые реально работают' },
  { icon: Wallet, text: 'Финансы под контролем' },
  { icon: Grid3x3, text: 'Мандала 9×9: одна цель — 64 действия' },
]

const BRAND_FEATS_KG = [
  { icon: ListChecks, text: 'Тапшырмалар, адаттар, максаттар' },
  { icon: Flame, text: 'Реалдуу серия куруу' },
  { icon: Wallet, text: 'Финансыңызды башкаруу' },
  { icon: Grid3x3, text: 'Мандала 9×9: бир максат — 64 аракет' },
]

export default function AuthShell({ title, subtitle, children, footer, showBack }) {
  const { lang, setLang, languages } = useLang()

  const feats = lang === 'ru' ? BRAND_FEATS_RU : lang === 'kg' ? BRAND_FEATS_KG : BRAND_FEATS

  return (
    <div className="auth-page">
      {/* Left brand panel — desktop only */}
      <div className="auth-brand-panel">
        <div className="auth-brand-logo">
          <Logo size={40} animated />
          <span className="auth-brand-name">BullBir</span>
        </div>

        <p className="auth-brand-tagline">
          {lang === 'ru' ? <>Твоя жизнь,<br /><span>в порядке.</span></> :
           lang === 'kg' ? <>Жашооңуз,<br /><span>тартипте.</span></> :
           <>Your life,<br /><span>organised.</span></>}
        </p>

        <div className="auth-brand-features">
          {feats.map((f, i) => (
            <motion.div
              key={i}
              className="auth-brand-feat"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
            >
              <div className="auth-brand-feat-icon"><Icon icon={f.icon} size="1em" /></div>
              <span className="auth-brand-feat-text">{f.text}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Right form panel */}
      <div className="auth-form-panel">
        <motion.div
          className="auth-form-inner"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="auth-toprow">
            {showBack ? (
              <Link to="/login" className="auth-back-btn">
                <Icon icon={ArrowLeft} size={16} />
                {lang === 'ru' ? 'Назад' : lang === 'kg' ? 'Артка' : 'Back'}
              </Link>
            ) : <div />}
            <div className="lang-mini">
              {languages.map((l) => (
                <button key={l.code} className={lang === l.code ? 'active' : ''} onClick={() => setLang(l.code)}>
                  {l.code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="auth-head">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>

          {children}

          {footer && <div className="auth-foot">{footer}</div>}
        </motion.div>
      </div>
    </div>
  )
}
