// Pure state machine for the chat-style interview (one question at a time).
// State = { phase: 'chat'|'safety'|'summary', step, answers, messages, safetyKey, summary }
// Message = { id, from: 'ai'|'me', key?: string, text?: string, tone?: 'note' }
import { nextStep, applyAnswer } from '../../../../ai/engine/interview'
import { checkSafety, stopsPlanning } from '../../../../ai/engine/safety'

export const ANSWER_MAX = 500

const withMessage = (messages, msg) => [...messages, { id: `m${messages.length}`, ...msg }]

function ask(state, answers, domains) {
  const next = nextStep(answers, { domains })
  if (next.done) return { ...state, answers, phase: 'summary', step: null, summary: next.summary }
  return {
    ...state,
    answers,
    phase: 'chat',
    step: next.step,
    messages: withMessage(state.messages, { from: 'ai', key: next.key }),
  }
}

/** First state: the AI asks the first question. */
export function startInterview({ domains = [] } = {}) {
  return ask({ phase: 'chat', step: null, answers: {}, messages: [], safetyKey: null, summary: null }, {}, domains)
}

/**
 * Handles one user answer: safety screen → store → next question / clarify / summary.
 * Crisis and violence stop the flow (phase 'safety'); other safety levels add a gentle note.
 */
export function submitAnswer(state, text, { domains = [] } = {}) {
  const value = String(text ?? '').trim().slice(0, ANSWER_MAX)
  if (!value || state.phase !== 'chat' || !state.step) return state
  const messages = withMessage(state.messages, { from: 'me', text: value })
  const safety = checkSafety(value)
  if (stopsPlanning(safety.level)) return { ...state, messages, phase: 'safety', safetyKey: safety.key }
  const noted = safety.key ? withMessage(messages, { from: 'ai', key: safety.key, tone: 'note' }) : messages
  return ask({ ...state, messages: noted, safetyKey: null }, applyAnswer(state.answers, state.step, value), domains)
}

/** "Go back" from the safety screen: the stopped answer is discarded, the question is asked again. */
export function resumeInterview(state, { domains = [] } = {}) {
  if (state.phase !== 'safety') return state
  return ask({ ...state, safetyKey: null }, state.answers, domains)
}

/** Text of a message, translated when it carries a key. */
export const messageText = (msg, t) => (msg.key ? t(msg.key) : msg.text)
