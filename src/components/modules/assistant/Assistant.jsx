import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../../../context/LangContext'
import { useToast } from '../../ui/Toast'
import { useAiLibrary } from '../../../ai/useAiLibrary'
import { useAiState, useIsAdmin } from '../../../ai/useAiState'
import { useAssistantData } from './useAssistantData'
import CoachChat from './CoachChat'
import ReviewPanel from './ReviewPanel'
import RewardsPanel from './RewardsPanel'
import { Bot, ChartColumn, Lock, MessageCircle, Settings, Trophy } from 'lucide-react'
import Icon from '../../ui/Icon'
import './Assistant.css'

const TABS = ['coach', 'review', 'rewards']
const TAB_ICONS = { coach: MessageCircle, review: ChartColumn, rewards: Trophy }

function ConsentCard({ consent, onChange, t }) {
  return (
    <div className="card ai-consent">
      <div>
        <strong><Icon icon={Lock} size="1em" /> {t('ai.consent.title')}</strong>
        <p className="text-secondary">{t('ai.consent.text')}</p>
      </div>
      <label className="mandala-check">
        <input type="checkbox" checked={consent} onChange={(e) => onChange(e.target.checked)} />
        <span>{t('ai.consent.allow')}</span>
      </label>
    </div>
  )
}

/** BullBir's own assistant: coach chat, weekly review with pace, and rewards. */
export default function Assistant() {
  const { t } = useLang()
  const toast = useToast()
  const [tab, setTab] = useState('coach')
  const { intents } = useAiLibrary()
  const { consentAllModules, setConsent } = useAiState()
  const isAdmin = useIsAdmin()
  const data = useAssistantData(consentAllModules)

  const changeConsent = (value) => setConsent(value).catch(() => toast.error(t('common.error')))

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="module-header">
        <div>
          <h2 style={{ letterSpacing: '-0.02em' }}><Icon icon={Bot} size="1em" /> {t('nav.assistant')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 4 }}>{t('ai.subtitle')}</p>
        </div>
        {isAdmin && <Link className="btn btn-secondary btn-sm" to="/app/admin/ai"><Icon icon={Settings} size="1em" /> {t('ai.admin.open')}</Link>}
      </div>

      <ConsentCard consent={consentAllModules} onChange={changeConsent} t={t} />

      <div className="tasks-tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={`tasks-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            <Icon icon={TAB_ICONS[id]} size="1em" /> {t(`ai.tab.${id}`)}
          </button>
        ))}
      </div>

      {tab === 'coach' && <CoachChat intents={intents} review={data.review} rewards={data.rewards} />}
      {tab === 'review' && <ReviewPanel review={data.review} paces={data.paces} consentAllModules={consentAllModules} />}
      {tab === 'rewards' && <RewardsPanel rewards={data.rewards} />}
    </div>
  )
}
