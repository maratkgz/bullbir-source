import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Send } from 'lucide-react'
import Icon from '../../../ui/Icon'
import { useLang } from '../../../../context/LangContext'
import { INTERVIEW_STEPS } from '../../../../ai/engine/interview'
import { ANSWER_MAX, messageText } from './interviewFlow'

const MINUTE_CHIPS = [15, 30, 60]

function Bubble({ msg, t, reduceMotion }) {
  const classes = ['iv-bubble', `iv-bubble--${msg.from}`, msg.tone && `iv-bubble--${msg.tone}`].filter(Boolean).join(' ')
  const motionProps = reduceMotion ? {} : {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.22, ease: 'easeOut' },
  }
  return <motion.li className={classes} {...motionProps}>{messageText(msg, t)}</motion.li>
}

/** Chat screen: the coach asks one question at a time, the user answers in a single field. */
export default function InterviewChat({ state, onSubmit, onManual }) {
  const { t } = useLang()
  const reduceMotion = useReducedMotion()
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const stepNo = INTERVIEW_STEPS.indexOf(state.step) + 1

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
    inputRef.current?.focus()
  }, [state.messages.length, reduceMotion])

  const send = (text) => {
    if (!text.trim()) return
    onSubmit(text)
    setDraft('')
  }
  const handleSubmit = (e) => {
    e.preventDefault()
    send(draft)
  }
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(draft)
    }
  }

  return (
    <div className="iv-chat card">
      <div className="iv-progress">
        <span>{t('mandala.wizard.step', { n: stepNo, total: INTERVIEW_STEPS.length })}</span>
        <span className="iv-progress-bar" style={{ '--p': `${(stepNo / INTERVIEW_STEPS.length) * 100}%` }} aria-hidden="true" />
      </div>

      <ol className="iv-log" role="log" aria-live="polite" aria-label={t('mandala.wizard.chatLabel')}>
        {state.messages.map((msg) => <Bubble key={msg.id} msg={msg} t={t} reduceMotion={reduceMotion} />)}
        <li ref={endRef} className="iv-end" aria-hidden="true" />
      </ol>

      {state.step === 'minutes' && (
        <div className="ai-chips iv-quick">
          {MINUTE_CHIPS.map((n) => (
            <button key={n} type="button" className="ai-chip" onClick={() => send(t('mandala.wizard.minutesChip', { n }))}>
              {t('mandala.wizard.minutesChip', { n })}
            </button>
          ))}
        </div>
      )}

      <form className="iv-input" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="input"
          rows={2}
          value={draft}
          maxLength={ANSWER_MAX}
          placeholder={t('mandala.wizard.placeholder')}
          aria-label={t('mandala.wizard.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="submit" className="btn btn-primary iv-send" disabled={!draft.trim()} aria-label={t('mandala.wizard.send')}>
          <Icon icon={Send} size={18} />
        </button>
      </form>

      <button type="button" className="btn btn-ghost btn-sm iv-manual" onClick={onManual}>
        {t('mandala.wizard.manual')}
      </button>
    </div>
  )
}
