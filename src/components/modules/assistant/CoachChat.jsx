import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { RotateCcw, SendHorizontal } from 'lucide-react'
import { useLang } from '../../../context/LangContext'
import { useAuth } from '../../../context/AuthContext'
import Icon from '../../ui/Icon'
import { MAX_MESSAGE, useCoachChat } from './useCoachChat'

const QUICK_KEYS = ['ai.quick.pace', 'ai.quick.focus', 'ai.quick.motivation', 'ai.quick.rewards']

/** Turns live insights of one kind into a short text block for the coach's answer. */
function useInsightDescriber({ review, rewards }) {
  const { t } = useLang()
  return (kind) => {
    if (kind === 'rewards') {
      const unlocked = rewards.badges.filter((b) => b.unlocked).length
      return t('ai.rewards.summary', { level: rewards.level, xp: rewards.xp, badges: unlocked, total: rewards.badges.length })
    }
    const lines = review.insights
      .filter((i) => i.kind === kind || (kind === 'progress' && i.kind === 'pace'))
      .map((i) => `• ${t(i.key, i.vars)}`)
    return lines.length ? lines.join('\n') : t('ai.coach.noData')
  }
}

/** First word of the display name ("Марат Иванов" → "Марат"), or '' when there is none. */
const firstName = (displayName) => (typeof displayName === 'string' ? displayName.trim().split(/\s+/)[0] || '' : '')

function TypingBubble({ label }) {
  return (
    <div className="ai-msg ai-msg--bot ai-typing" role="status" aria-label={label}>
      <span /><span /><span />
    </div>
  )
}

/** Quick replies: static starters on an empty chat, then the engine's suggestions (+ yes/no). */
function ChatChips({ chat, t }) {
  const disabled = chat.typing
  if (!chat.started) {
    return QUICK_KEYS.map((k) => (
      <button key={k} type="button" className="ai-chip" disabled={disabled} onClick={() => chat.send(t(k))}>{t(k)}</button>
    ))
  }
  if (chat.stopped) return null
  const yesNo = chat.followUp ? ['ai.coach.yes', 'ai.coach.no'] : []
  return (
    <>
      {yesNo.map((k) => (
        <button key={k} type="button" className="ai-chip ai-chip--answer" disabled={disabled} onClick={() => chat.send(t(k))}>{t(k)}</button>
      ))}
      {chat.suggestions.map((s) => (
        <button key={s.id} type="button" className="ai-chip" disabled={disabled} onClick={() => chat.choose(s)}>{s.label}</button>
      ))}
    </>
  )
}

/**
 * Retrieval-based coach chat (own rule-based engine, no external AI). The conversation is
 * kept only for this browser tab (sessionStorage) and cleared by "New conversation".
 */
export default function CoachChat({ intents, review, rewards }) {
  const { t, lang } = useLang()
  const { user } = useAuth()
  const reduceMotion = useReducedMotion()
  const describeInsight = useInsightDescriber({ review, rewards })
  const name = firstName(user?.displayName)
  const chat = useCoachChat({
    intents, lang, t, describeInsight, name, storageId: user?.uid || null, reduceMotion: !!reduceMotion,
  })
  const [draft, setDraft] = useState('')
  const logRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [chat.messages.length, chat.typing, reduceMotion])

  const submit = (e) => {
    e.preventDefault()
    if (chat.send(draft)) setDraft('')
  }

  const startOver = () => {
    chat.reset()
    setDraft('')
    inputRef.current?.focus()
  }

  const greeting = name ? t('ai.coach.greetingName', { name }) : t('ai.coach.greeting')
  const lastBot = [...chat.messages].reverse().find((m) => m.from === 'bot')

  return (
    <div className="card ai-chat">
      <div className="ai-chat-head">
        <span className="text-secondary">{t('ai.coach.sessionNote')}</span>
        {chat.started && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={startOver}>
            <Icon icon={RotateCcw} size="1em" /> {t('ai.coach.newChat')}
          </button>
        )}
      </div>
      <div className="ai-chat-log" ref={logRef}>
        <div className="ai-msg ai-msg--bot">{greeting}</div>
        {chat.messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg--${m.from}`}>
            {m.from === 'me' && <span className="sr-only">{t('ai.coach.you')}: </span>}
            {m.text}
          </div>
        ))}
        {chat.typing && <TypingBubble label={t('ai.coach.typing')} />}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{lastBot?.text || ''}</div>
      <div className="ai-chips"><ChatChips chat={chat} t={t} /></div>
      <form className="ai-chat-input" onSubmit={submit}>
        <input
          ref={inputRef}
          className="input"
          value={draft}
          maxLength={MAX_MESSAGE}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('ai.coach.placeholder')}
          aria-label={t('ai.coach.placeholder')}
          enterKeyHint="send"
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={!draft.trim() || chat.typing} aria-label={t('ai.coach.send')}>
          <Icon icon={SendHorizontal} />
        </button>
      </form>
    </div>
  )
}
