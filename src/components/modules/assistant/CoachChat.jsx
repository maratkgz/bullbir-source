import { useEffect, useRef, useState } from 'react'
import { useLang } from '../../../context/LangContext'
import { answer } from '../../../ai/engine/coach'

const MAX_MESSAGE = 300
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

/** Retrieval-based coach chat. Messages live only in memory — nothing is saved. */
export default function CoachChat({ intents, review, rewards }) {
  const { t, lang } = useLang()
  const describeInsight = useInsightDescriber({ review, rewards })
  const [messages, setMessages] = useState(() => [{ from: 'bot', text: t('ai.coach.hello') }])
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])

  const send = (text) => {
    const clean = text.trim().slice(0, MAX_MESSAGE)
    if (!clean) return
    const reply = answer(clean, intents, { lang, describeInsight })
    setMessages((m) => [...m, { from: 'me', text: clean }, { from: 'bot', text: reply.text }])
    setDraft('')
  }

  return (
    <div className="card ai-chat">
      <div className="ai-chat-log" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg--${m.from}`}>{m.text}</div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="ai-chips">
        {QUICK_KEYS.map((k) => (
          <button key={k} type="button" className="ai-chip" onClick={() => send(t(k))}>{t(k)}</button>
        ))}
      </div>
      <form className="ai-chat-input" onSubmit={(e) => { e.preventDefault(); send(draft) }}>
        <input
          className="input"
          value={draft}
          maxLength={MAX_MESSAGE}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('ai.coach.placeholder')}
          aria-label={t('ai.coach.placeholder')}
        />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>{t('ai.coach.send')}</button>
      </form>
    </div>
  )
}
