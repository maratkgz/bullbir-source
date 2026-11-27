import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useLang } from '../context/LangContext'
import Logo from './ui/Logo'
import Icon from './ui/Icon'
import { MODULE_ICONS } from '../config/moduleIcons'

// Minimal landing: one message, two actions, a short list of what's inside. No numbers we
// can't back up (no fake user counts or ratings).
const FEATURES = ['tasks', 'habits', 'goals', 'mandala', 'journal', 'finance']
const LANGS = ['ru', 'kg', 'en']

function useFade() {
  const reduce = useReducedMotion()
  return (delay = 0) => (reduce
    ? {}
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] } })
}

export default function Landing() {
  const { t, lang, setLang } = useLang()
  const fade = useFade()

  return (
    <div className="land-root lp">
      <header className="land-nav">
        <div className="land-container lp-nav">
          <Link to="/" className="land-brand" aria-label="BullBir">
            <Logo size={30} />
            <span className="land-brand-name">BullBir</span>
          </Link>
          <div className="lp-nav-actions">
            <div className="land-lang-seg" role="group" aria-label="Language">
              {LANGS.map((l) => (
                <button key={l} type="button" aria-pressed={lang === l}
                  className={`land-lang-btn${lang === l ? ' active' : ''}`} onClick={() => setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <Link to="/login" className="btn btn-ghost lp-login">{t('land.hero.login')}</Link>
          </div>
        </div>
      </header>

      <main className="land-container lp-hero">
        <motion.h1 {...fade(0.05)} className="lp-title">
          {t('land.hero.title').split('\n').map((line, i) => (
            <span key={i} className={i === 1 ? 'text-gradient' : undefined}>{line}</span>
          ))}
        </motion.h1>
        <motion.p {...fade(0.15)} className="lp-sub">{t('land.hero.sub')}</motion.p>
        <motion.div {...fade(0.25)} className="lp-cta">
          <Link to="/register" className="btn btn-primary lp-cta-main">{t('land.hero.cta')}</Link>
          <Link to="/login" className="btn btn-ghost">{t('land.hero.login')} →</Link>
        </motion.div>

        <motion.ul {...fade(0.35)} className="lp-features" aria-label={t('land.feat.title')}>
          {FEATURES.map((key) => (
            <li key={key} className="lp-feature">
              <Icon icon={MODULE_ICONS[key]} size={18} />
              <span>{t(`land.feat.${key}`)}</span>
            </li>
          ))}
        </motion.ul>
      </main>

      <footer className="land-container lp-footer">
        <span className="text-muted">{t('land.footer.rights')}</span>
      </footer>
    </div>
  )
}
