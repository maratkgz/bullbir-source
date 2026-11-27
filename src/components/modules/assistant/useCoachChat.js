// Chat state for the coach: messages, dialogue context, quick replies, typing delay and
// per-tab persistence (sessionStorage). The engine itself is pure; this hook only wires it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { answer, answerIntent } from '../../../ai/engine/coach'
import { checkSafety, stopsPlanning } from '../../../ai/engine/safety'

export const MAX_MESSAGE = 300
const MAX_STORED_MESSAGES = 60
const STORAGE_PREFIX = 'bb.coach.v1.'
const TYPING_MIN_MS = 400
const TYPING_MAX_MS = 700
const TYPING_MS_PER_CHAR = 2

const EMPTY = { messages: [], ctx: null, suggestions: [], stopped: false }

/** Deterministic "thinking" delay: longer answers take a little longer, within 400–700 ms. */
export const typingDelay = (text) =>
  Math.min(TYPING_MAX_MS, TYPING_MIN_MS + String(text || '').length * TYPING_MS_PER_CHAR)

const isMessage = (m) => m && (m.from === 'me' || m.from === 'bot') && typeof m.text === 'string'
const isSuggestion = (s) => s && typeof s.id === 'string' && typeof s.label === 'string'

function loadChat(key) {
  if (!key) return EMPTY
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(key) || 'null')
    if (!raw || !Array.isArray(raw.messages)) return EMPTY
    return {
      messages: raw.messages.filter(isMessage).slice(-MAX_STORED_MESSAGES),
      ctx: raw.ctx && typeof raw.ctx === 'object' ? raw.ctx : null,
      suggestions: Array.isArray(raw.suggestions) ? raw.suggestions.filter(isSuggestion) : [],
      stopped: raw.stopped === true,
    }
  } catch {
    return EMPTY
  }
}

function saveChat(key, chat) {
  if (!key) return
  try {
    if (!chat.messages.length) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, JSON.stringify({ ...chat, messages: chat.messages.slice(-MAX_STORED_MESSAGES) }))
  } catch {
    // Private mode / quota: the chat simply isn't kept for this tab.
  }
}

const isSafetyIntent = (intents, id) => Number(intents.find((i) => i.id === id)?.priority) > 0

/**
 * Applies the lexicon safety screen on top of the engine reply.
 * crisis/violence always override (no playful chips); illegal/health/money override only
 * when the engine itself didn't already pick one of its safety intents.
 */
function withSafety(reply, safety, intents, t) {
  if (safety.level === 'ok' || !safety.key) return { ...reply, stopped: false }
  if (stopsPlanning(safety.level)) {
    return { ...reply, text: t(safety.key), suggestions: [], context: { ...reply.context, followUp: null }, stopped: true }
  }
  if (isSafetyIntent(intents, reply.intentId)) return { ...reply, stopped: false }
  return { ...reply, text: t(safety.key), context: { ...reply.context, followUp: null }, stopped: false }
}

/**
 * @param {{ intents: object[], lang: string, t: Function, describeInsight: Function,
 *   name?: string, storageId?: string|null, reduceMotion?: boolean }} options
 */
export function useCoachChat({ intents, lang, t, describeInsight, name, storageId, reduceMotion }) {
  const storageKey = storageId ? `${STORAGE_PREFIX}${storageId}` : null
  const [chat, setChat] = useState(() => loadChat(storageKey))
  const [typing, setTyping] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => { saveChat(storageKey, chat) }, [storageKey, chat])
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const deliver = useCallback((userText, reply) => {
    const userMsg = { from: 'me', text: userText }
    const botMsg = { from: 'bot', text: reply.text }
    const finish = () => {
      setTyping(false)
      setChat((c) => ({
        messages: [...c.messages, botMsg],
        ctx: reply.context,
        suggestions: reply.suggestions || [],
        stopped: reply.stopped,
      }))
    }
    setChat((c) => ({ ...c, messages: [...c.messages, userMsg] }))
    if (reduceMotion) { finish(); return }
    setTyping(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(finish, typingDelay(reply.text))
  }, [reduceMotion])

  const options = { lang, describeInsight, context: chat.ctx, ...(name ? { name } : {}) }

  const send = (text) => {
    const clean = String(text || '').trim().slice(0, MAX_MESSAGE)
    if (!clean || typing) return false
    const reply = answer(clean, intents, options)
    deliver(clean, withSafety(reply, checkSafety(clean), intents, t))
    return true
  }

  const choose = (suggestion) => {
    if (typing || !isSuggestion(suggestion)) return
    const reply = answerIntent(suggestion.id, intents, options)
    deliver(suggestion.label, { ...reply, stopped: false })
  }

  const reset = () => {
    clearTimeout(timerRef.current)
    setTyping(false)
    setChat(EMPTY)
  }

  return {
    messages: chat.messages,
    suggestions: chat.suggestions,
    stopped: chat.stopped,
    followUp: Boolean(chat.ctx?.followUp),
    started: chat.messages.length > 0,
    typing,
    send,
    choose,
    reset,
  }
}
