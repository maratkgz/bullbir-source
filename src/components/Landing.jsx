import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useLang } from '../context/LangContext'
import Logo from './ui/Logo'

const FEATURES = [
  { key: 'tasks',   icon: '✅', path: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2' },
  { key: 'habits',  icon: '🔥', path: 'M12 2c0 0-5 6-5 10a5 5 0 0 0 10 0c0-4-5-10-5-10zM9 12a3 3 0 0 0 3 3' },
  { key: 'goals',   icon: '🎯', path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12M12 9a3 3 0 1 0 0 6' },
  { key: 'finance', icon: '💰', path: 'M3 17l5-5 4 4 8-8M16 8h4v4' },
  { key: 'journal', icon: '📓', path: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2ZM8 7h7M8 11h7' },
  { key: 'ai',      icon: '🤖', path: 'M12 2L9 9H2l5.5 4-2 7L12 16l6.5 4-2-7L22 9h-7z' },
]

const STATS = [
  { key: 'users', value: '10K+' },
  { key: 'tasks', value: '500K+' },
  { key: 'rating', value: '4.9 ★' },
]

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
})

export default function Landing() {
  const { t, lang, setLang } = useLang()

  return (
    <div className="land-root">
      {/* NAV */}
      <header className="land-nav">
        <div className="land-container land-nav-inner">
          <Link to="/" className="land-brand">
            <Logo size={32} animated />
            <span className="land-brand-name">BullBir</span>
          </Link>

          <nav className="land-nav-links">
            <a href="#features" className="land-nav-link">{t('land.nav.features')}</a>
            <a href="#about" className="land-nav-link">{t('land.nav.about')}</a>
          </nav>

          <div className="land-nav-actions">
            {/* Lang selector */}
            <div className="land-lang-seg">
              {['ru','kg','en'].map(l => (
                <button
                  key={l}
                  className={`land-lang-btn${lang === l ? ' active' : ''}`}
                  onClick={() => setLang(l)}
                >{l.toUpperCase()}</button>
              ))}
            </div>
            <Link to="/login" className="btn btn-ghost land-nav-btn">{t('land.hero.login')}</Link>
            <Link to="/register" className="btn btn-primary">{t('land.hero.cta')}</Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="land-hero">
        <div className="land-hero-glow" />
        <div className="land-container land-hero-inner">
          <motion.div {...fade(0.1)} className="land-hero-content">
            <span className="land-badge">{t('land.hero.badge')}</span>
            <h1 className="land-hero-title">
              {t('land.hero.title').split('\n').map((line, i) => (
                <span key={i}>
                  {i === 1 ? <span className="text-gradient">{line}</span> : line}
                  {i === 0 && <br />}
                </span>
              ))}
            </h1>
            <p className="land-hero-sub">{t('land.hero.sub')}</p>
            <div className="land-hero-cta">
              <Link to="/register" className="btn btn-primary land-cta-btn">{t('land.hero.cta')}</Link>
              <Link to="/login" className="btn btn-ghost land-login-btn">{t('land.hero.login')} →</Link>
            </div>
          </motion.div>

          {/* App preview card */}
          <motion.div {...fade(0.25)} className="land-preview-wrap">
            <div className="land-preview-card">
              <div className="land-preview-bar">
                <span className="land-dot" style={{ background: '#ef4444' }} />
                <span className="land-dot" style={{ background: '#fbbf24' }} />
                <span className="land-dot" style={{ background: '#4ade80' }} />
              </div>
              <div className="land-preview-content">
                {/* mock streak card */}
                <div className="land-mock-card land-mock-hero">
                  <div style={{ fontSize: 28 }}>🔥</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>14-day streak</div>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>Keep going!</div>
                  </div>
                </div>
                {/* mock stat row */}
                <div className="land-mock-stats">
                  {[['✅','8 Tasks','done'],['🎯','3 Goals','active'],['💰','Budget','on track']].map(([ic,lb,sub]) => (
                    <div key={lb} className="land-mock-stat">
                      <span style={{ fontSize: 18 }}>{ic}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 11 }}>{lb}</div>
                        <div style={{ fontSize: 10, opacity: 0.6 }}>{sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* mock habit rows */}
                {[['💪','Morning workout','#7c5cff',5],['📚','Read 20 pages','#10b981',12],['💧','Drink water','#06b6d4',3]].map(([ic,name,col,days]) => (
                  <div key={name} className="land-mock-habit">
                    <span style={{ fontSize: 16 }}>{ic}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{name}</span>
                    <span style={{ fontSize: 11, color: col, fontWeight: 700 }}>🔥 {days}</span>
                    <div className="land-mock-dot" style={{ background: col }} />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Stats bar */}
        <motion.div {...fade(0.4)} className="land-stats-bar">
          <div className="land-container land-stats-inner">
            {STATS.map(s => (
              <div key={s.key} className="land-stat">
                <span className="land-stat-value">{s.value}</span>
                <span className="land-stat-label">{t(`land.stats.${s.key}`)}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* FEATURES */}
      <section id="features" className="land-features">
        <div className="land-container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="land-section-head"
          >
            <h2>{t('land.feat.title')}</h2>
            <p className="text-muted">{t('land.feat.sub')}</p>
          </motion.div>

          <div className="land-feat-grid">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.key}
                className="land-feat-card card"
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07, duration: 0.45 }}
                whileHover={{ y: -6, boxShadow: '0 16px 48px rgba(124,92,255,0.18)' }}
              >
                <div className="land-feat-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={f.path} />
                  </svg>
                </div>
                <h3>{t(`land.feat.${f.key}`)}</h3>
                <p className="text-muted">{t(`land.feat.${f.key}Sub`)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA BAND */}
      <section id="about" className="land-cta-band">
        <div className="land-cta-glow" />
        <div className="land-container land-cta-inner">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="land-cta-title">{t('land.cta.title')}</h2>
            <p className="land-cta-sub">{t('land.cta.sub')}</p>
            <Link to="/register" className="btn btn-primary land-cta-btn" style={{ marginTop: 'var(--space-5)' }}>
              {t('land.cta.btn')}
            </Link>
          </motion.div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="land-footer">
        <div className="land-container land-footer-inner">
          <div className="land-brand">
            <Logo size={24} />
            <span className="land-brand-name">BullBir</span>
          </div>
          <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{t('land.footer.rights')}</p>
        </div>
      </footer>
    </div>
  )
}
