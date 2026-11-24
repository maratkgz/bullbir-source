import { useLang } from '../../../context/LangContext'
import { CircleCheck, Lightbulb, TriangleAlert } from 'lucide-react'
import Icon from '../../ui/Icon'

const SEVERITY_ICON = { good: CircleCheck, warn: TriangleAlert, info: Lightbulb }

function Stat({ value, label }) {
  return (
    <div className="ai-stat">
      <span className="ai-stat-value">{value}</span>
      <span className="ai-stat-label">{label}</span>
    </div>
  )
}

/** Weekly review + pace of every mandala. */
export default function ReviewPanel({ review, paces, consentAllModules }) {
  const { t } = useLang()
  const s = review.stats
  return (
    <div className="ai-review">
      <div className="ai-stats">
        {consentAllModules && <Stat value={s.tasksDone} label={t('ai.review.tasksDone')} />}
        {consentAllModules && <Stat value={s.tasksOverdue} label={t('ai.review.overdue')} />}
        {consentAllModules && <Stat value={s.habitCheckins} label={t('ai.review.habits')} />}
        {consentAllModules && <Stat value={s.moodAvg ?? '—'} label={t('ai.review.mood')} />}
        <Stat value={paces.length} label={t('ai.review.mandalas')} />
      </div>

      {paces.length > 0 && (
        <div className="card">
          <span className="section-title">{t('ai.review.paceTitle')}</span>
          <ul className="ai-pace-list">
            {paces.map(({ mandala, pace }) => (
              <li key={mandala.id} className={`ai-pace ai-pace--${pace.status}`}>
                <strong>{mandala.title}</strong>
                <span>
                  {t(`ai.pace.${pace.status}`, {
                    rate: pace.weeklyRate, required: pace.requiredRate, delay: pace.delayWeeks ?? '—', date: pace.projectedDate ?? '—',
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <span className="section-title">{t('ai.review.insights', { from: review.period.from, to: review.period.to })}</span>
        <ul className="ai-insights">
          {review.insights.map((i, n) => (
            <li key={n} className={`ai-insight ai-insight--${i.severity}`}>
              <Icon icon={SEVERITY_ICON[i.severity]} size={18} />
              <span>{t(i.key, i.vars)}</span>
            </li>
          ))}
        </ul>
        {!consentAllModules && <p className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>{t('ai.review.limited')}</p>}
      </div>
    </div>
  )
}
