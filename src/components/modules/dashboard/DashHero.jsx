import { motion } from 'framer-motion'
import { CircleCheck, Flame, Hand } from 'lucide-react'
import Icon from '../../ui/Icon'
import { useLang } from '../../../context/LangContext'
import { greetingKey } from './dashboardModel'

const LOCALES = { en: 'en-US', ru: 'ru-RU', kg: 'ky-KG' }

/** Greeting card: date, "Good evening, Name 👋", today's status and the streak badge under it. */
export default function DashHero({ name, completedToday, streak, variants }) {
  const { t, lang } = useLang()
  const date = new Date().toLocaleDateString(LOCALES[lang] || undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  // The last word and the hand share a no-wrap span so the hand never drops to its own line.
  const words = `${t(greetingKey())}${name ? `, ${name}` : ''}`.split(' ')
  const lastWord = words.pop()

  return (
    <motion.section className="card dash-hero-card" variants={variants} aria-labelledby="dash-greeting">
      <p className="dash-greeting-sub">{date}</p>
      <h2 id="dash-greeting" className="dash-greeting">
        {words.length > 0 && `${words.join(' ')} `}
        <span className="dash-nowrap">
          {lastWord}
          &nbsp;
          <Icon icon={Hand} size="1em" className="dash-greeting-wave" />
        </span>
      </h2>
      <p className="dash-hero-status">
        {completedToday > 0 ? (
          <>
            <Icon icon={CircleCheck} size="1em" className="dash-inline-icon" />{' '}
            {completedToday} {t('dash.completedToday')}
          </>
        ) : (
          t('dash.noTasksToday')
        )}
      </p>
      {streak > 0 && (
        <div className="dash-streak-badge">
          <Icon icon={Flame} size={22} className="dash-streak-icon" />
          <span className="dash-streak-num">{streak}</span>
          <span className="dash-streak-label">{t('prog.streak')}</span>
        </div>
      )}
    </motion.section>
  )
}
