import { describe, it, expect } from 'vitest'
import { startInterview, submitAnswer, resumeInterview, messageText } from './interviewFlow'

const answerAll = (state, list) => list.reduce((s, text) => submitAnswer(s, text), state)
const GOOD = [
  'Run a half marathon next year', 'To feel strong and healthy', '30 minutes',
]

describe('interviewFlow', () => {
  it('starts with the first question', () => {
    const s = startInterview()
    expect(s).toMatchObject({ phase: 'chat', step: 'goal' })
    expect(s.messages).toEqual([{ id: 'm0', from: 'ai', key: 'ai.iv.q.goal' }])
  })

  it('records the answer and asks the next question', () => {
    const s = submitAnswer(startInterview(), '  Run a half marathon next year  ')
    expect(s.step).toBe('why')
    expect(s.answers.goal).toBe('Run a half marathon next year')
    expect(s.messages.map((m) => m.from)).toEqual(['ai', 'me', 'ai'])
    expect(s.messages[2].key).toBe('ai.iv.q.why')
  })

  it('re-asks once for a vague answer', () => {
    const s0 = submitAnswer(startInterview(), 'Run a half marathon next year')
    const s1 = submitAnswer(s0, 'idk')
    expect(s1.step).toBe('why')
    expect(s1.messages.at(-1).key).toBe('ai.iv.clarify.why')
    const s2 = submitAnswer(s1, 'idk')
    expect(s2.step).toBe('minutes')
  })

  it('ignores empty answers and does not mutate state', () => {
    const s = startInterview()
    expect(submitAnswer(s, '   ')).toBe(s)
    submitAnswer(s, 'Some long answer')
    expect(s.messages).toHaveLength(1)
  })

  it('ends with a summary', () => {
    const s = answerAll(startInterview(), GOOD)
    expect(s.phase).toBe('summary')
    expect(s.summary).toMatchObject({ goal: 'Run a half marathon next year', minutesPerDay: 30 })
  })

  it('stops on crisis text and can resume with the same question', () => {
    const s = submitAnswer(startInterview(), 'хочу умереть')
    expect(s.phase).toBe('safety')
    expect(s.safetyKey).toBe('ai.safety.crisis')
    expect(s.answers.goal).toBeUndefined()
    expect(submitAnswer(s, 'anything else here')).toBe(s)
    const back = resumeInterview(s)
    expect(back).toMatchObject({ phase: 'chat', step: 'goal', safetyKey: null })
    expect(back.messages.at(-1).key).toBe('ai.iv.q.goal')
  })

  it('adds a gentle note for non-stopping safety levels and continues', () => {
    const s = submitAnswer(startInterview(), 'хочу купить акции и биткоин')
    expect(s.phase).toBe('chat')
    expect(s.messages.some((m) => m.tone === 'note' && m.key === 'ai.safety.money')).toBe(true)
    expect(s.step).toBe('why')
  })

  it('translates key messages only', () => {
    const t = (k) => `T:${k}`
    expect(messageText({ key: 'a' }, t)).toBe('T:a')
    expect(messageText({ text: 'b' }, t)).toBe('b')
  })
})
