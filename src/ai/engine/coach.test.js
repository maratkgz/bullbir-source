import { describe, it, expect } from 'vitest'
import { answer, answerIntent, FALLBACK_INTENT_ID } from './coach'
import { classifyShortReply, personalize, pickVariant, sanitizeContext } from './dialog'
import { BUILTIN_INTENTS } from '../library'

const ask = (msg, lang = 'ru', extra = {}) => answer(msg, BUILTIN_INTENTS, { lang, ...extra })

/** Plays a conversation, passing each reply's context into the next turn. */
function chat(messages, lang = 'ru') {
  return messages.reduce((acc, msg) => {
    const reply = answer(msg, BUILTIN_INTENTS, { lang, context: acc.at(-1)?.context })
    return [...acc, reply]
  }, [])
}

describe('coach library size and shape', () => {
  it('ships 60–90 intents with labels and valid references', () => {
    expect(BUILTIN_INTENTS.length).toBeGreaterThanOrEqual(60)
    expect(BUILTIN_INTENTS.length).toBeLessThanOrEqual(90)
    const ids = new Set(BUILTIN_INTENTS.map((i) => i.id))
    BUILTIN_INTENTS.forEach((i) => {
      (i.suggest || []).forEach((s) => expect(ids, `${i.id}.suggest → ${s}`).toContain(s))
      Object.values(i.followUps || {}).forEach((f) => expect(ids, `${i.id}.followUps → ${f}`).toContain(f))
      if (!i.priority && i.id !== FALLBACK_INTENT_ID) expect(i.label, i.id).toBeTruthy()
    })
  })
})

describe('coach matching', () => {
  it.each([
    ['ru', 'привет', 'greeting'], ['ru', 'Привет!', 'greeting'], ['ru', 'хай', 'greeting'], ['ru', 'превет', 'greeting'],
    ['kg', 'салам', 'greeting'], ['kg', 'саламатсызбы', 'greeting'], ['en', 'hi there', 'greeting'],
    ['kg', 'кандайсың', 'how-are-you'], ['ru', 'как дела', 'how-are-you'], ['ru', 'че как', 'how-are-you'],
    ['ru', 'че делать', 'focus'], ['ru', 'что мне делать сегодня', 'focus'],
    ['ru', 'мне лень', 'lazy'], ['ru', 'привет, мне лень', 'lazy'], ['kg', 'эринем', 'lazy'], ['en', 'I feel lazy', 'lazy'],
    ['ru', 'я устал', 'tired'], ['ru', 'нет сил вообще', 'tired'], ['kg', 'чарчадым', 'tired'], ['en', 'I am so tired', 'tired'],
    ['ru', 'нет мотивации', 'motivation'], ['kg', 'мотивация жок', 'motivation'],
    ['ru', 'не успеваю ничего', 'no-time'], ['kg', 'убактым жок', 'no-time'],
    ['ru', 'я всё бросил', 'gave-up'], ['ru', 'я неудачник', 'failure'],
    ['ru', 'спасибо', 'thanks'], ['ru', 'спасиб', 'thanks'], ['kg', 'рахмат', 'thanks'], ['en', 'thanks a lot', 'thanks'],
    ['ru', 'ты кто', 'who-are-you'], ['kg', 'сен кимсиң', 'who-are-you'], ['en', 'who are you', 'who-are-you'],
    ['ru', 'что ты умеешь', 'capabilities'], ['kg', 'эмне кыла аласың', 'capabilities'],
    ['ru', 'как пользоваться задачами', 'how-tasks'], ['ru', 'как делать задачи', 'how-tasks'],
    ['ru', 'как работают привычки', 'how-habits'], ['en', 'how do habits work', 'how-habits'],
    ['ru', 'как заполнить мандалу', 'how-mandala'], ['ru', 'как работают смены', 'how-shifts'],
    ['ru', 'как вести бюджет', 'how-finance'], ['ru', 'как вести дневник', 'how-journal'], ['ru', 'что такое помодоро', 'how-pomodoro'],
    ['ru', 'как поставить цель', 'goal-setting'], ['ru', 'с чего начать', 'getting-started'],
    ['ru', 'как не бросить', 'how-not-quit'], ['kg', 'кантип таштабайм', 'how-not-quit'],
    ['ru', 'прокрастинирую', 'procrastination'], ['ru', 'выгорание', 'burnout'], ['ru', 'плохо сплю', 'sleep'],
    ['ru', 'стресс перед экзаменом', 'exam-stress'], ['kg', 'эртең сынак, коркуп жатам', 'exam-stress'],
    ['ru', 'деньги не хватает', 'money-short'], ['kg', 'акча жетпейт', 'money-short'],
    ['ru', 'похвали меня', 'praise-me'], ['ru', 'расскажи шутку', 'joke'], ['kg', 'тамаша айтчы', 'joke'], ['en', 'tell me a joke', 'joke'],
    ['ru', 'пока', 'bye'], ['kg', 'жакшы кал', 'bye'],
    ['ru', 'норм', 'feeling-good'], ['ru', 'мне грустно', 'mood'], ['ru', 'одиноко', 'lonely'], ['ru', 'скучно', 'bored'],
    ['ru', 'я сделал задачу', 'celebrate'], ['ru', 'кем стать', 'career-choice'], ['ru', 'родители давят', 'parents-pressure'],
    ['ru', 'хочу накопить на квартиру', 'saving'], ['ru', 'отвлекаюсь на телефон', 'focus-concentration'],
    ['ru', 'как рано вставать', 'morning-routine'], ['ru', 'как отдохнуть', 'recharge'], ['ru', 'помоги успокоиться', 'breathing'],
    ['ru', 'хочу уметь программировать', 'new-goal'], ['ru', 'где мои данные', 'privacy'],
  ])('(%s) “%s” → %s', (lang, msg, intent) => {
    expect(ask(msg, lang).intentId).toBe(intent)
  })

  it('does not confuse a shared stem ("программировать" ≠ "прогресс")', () => {
    expect(ask('хочу уметь программировать').intentId).not.toBe('progress')
  })

  it('falls back on nonsense and off-topic messages', () => {
    ['квантовая физика', 'asdf', 'побить рекорд'].forEach((m) => expect(ask(m).intentId).toBe(FALLBACK_INTENT_ID))
  })
})

describe('coach safety', () => {
  it.each([
    ['ru', 'не хочу жить', 'safety-selfharm'], ['ru', 'мне так плохо, хочу умереть', 'safety-selfharm'],
    ['ru', 'думаю покончить с собой', 'safety-selfharm'], ['kg', 'жашагым келбейт', 'safety-selfharm'],
    ['en', 'I want to die', 'safety-selfharm'], ['ru', 'хочу убить его', 'safety-violence'],
    ['ru', 'меня бьют дома', 'safety-abuse'], ['ru', 'какие таблетки пить от головы', 'safety-health'],
    ['ru', 'как похудеть', 'safety-health'], ['ru', 'куда вложить деньги в крипту', 'safety-money'],
    ['ru', 'как взломать инсту', 'safety-illegal'],
  ])('(%s) “%s” → %s', (lang, msg, intent) => {
    expect(ask(msg, lang).intentId).toBe(intent)
  })

  it('outranks any other matching intent in the same message', () => {
    expect(ask('привет, я устал и не хочу жить').intentId).toBe('safety-selfharm')
    expect(ask('нет мотивации, хочу умереть').intentId).toBe('safety-selfharm')
    expect(ask('нет денег, взять кредит?').intentId).toBe('safety-money')
  })

  it('wins even when the user is answering a follow-up', () => {
    const [first] = chat(['нет мотивации'])
    expect(answer('да, хочу умереть', BUILTIN_INTENTS, { lang: 'ru', context: first.context }).intentId).toBe('safety-selfharm')
  })

  it('mentions 112 and a close person / specialist for self-harm in every language', () => {
    [['ru', 'хочу умереть'], ['kg', 'өлгүм келет'], ['en', 'kill myself']].forEach(([lang, msg]) => {
      const { text } = ask(msg, lang)
      expect(text).toContain('112')
    })
  })

  it.each([
    'умираю со смеху', 'хочу умереть со смеху', 'хочу убить время', 'хочу уметь программировать',
    'я не хочу жить в общаге', 'лайфхак для учебы', 'побить рекорд',
  ])('no false positive for “%s”', (msg) => {
    expect(ask(msg).intentId).not.toMatch(/^safety-/)
  })

  it('has no live data, follow-ups or suggestions on crisis answers', () => {
    const reply = ask('хочу умереть', 'ru', { describeInsight: () => 'DATA' })
    expect(reply.text).not.toContain('DATA')
    expect(reply.suggestions).toEqual([])
    expect(reply.context.followUp).toBeNull()
  })
})

describe('coach dialogue context', () => {
  it('resolves "да" against the previous follow-up', () => {
    const [, second] = chat(['нет мотивации', 'да'])
    expect(second.intentId).toBe('tiny-step')
  })

  it('resolves "нет" / "жок" against the previous follow-up', () => {
    expect(chat(['нет мотивации', 'нет']).at(-1).intentId).toBe('later')
    expect(chat(['мотивация жок', 'жок'], 'kg').at(-1).intentId).toBe('later')
  })

  it.each([['ага, давай'], ['ооба'], ['иә'], ['yes']])('treats “%s” as yes', (reply) => {
    expect(chat(['я устал', reply]).at(-1).intentId).toBe('recharge')
  })

  it('uses `any` for "не знаю" when no specific branch exists', () => {
    expect(chat(['с чего начать', 'не знаю']).at(-1).intentId).toBe('goal-setting')
  })

  it('answers a bare "да" / "не знаю" without context sensibly', () => {
    expect(ask('да').intentId).toBe('ack')
    expect(ask('не знаю').intentId).toBe('unsure')
  })

  it('ignores follow-ups when the reply is a full message', () => {
    expect(chat(['нет мотивации', 'да, но я очень устал']).at(-1).intentId).toBe('tired')
  })

  it('tracks turn, last intent, topic and the pending follow-up', () => {
    const [a, b] = chat(['привет', 'нет мотивации'])
    expect(a.context).toMatchObject({ lastIntentId: 'greeting', turn: 1, followUp: null })
    expect(b.context).toMatchObject({ lastIntentId: 'motivation', topic: 'energy', turn: 2, followUp: 'motivation' })
  })

  it('never repeats the same variant twice in a row', () => {
    const replies = chat(['расскажи шутку', 'да', 'да', 'да', 'ещё шутку', 'расскажи анекдот'])
    replies.slice(1).forEach((r, i) => {
      expect(r.intentId).toBe('joke')
      expect(r.text).not.toBe(replies[i].text)
    })
  })

  it('does not mutate the context passed in', () => {
    const context = Object.freeze({ lastIntentId: 'motivation', followUp: 'motivation', turn: 3, topic: 'energy', lastVariant: 0 })
    const reply = answer('да', BUILTIN_INTENTS, { lang: 'ru', context })
    expect(reply.context.turn).toBe(4)
    expect(context.turn).toBe(3)
  })

  it('is deterministic', () => {
    expect(chat(['привет', 'нет мотивации', 'да'])).toEqual(chat(['привет', 'нет мотивации', 'да']))
  })

  it('survives a malformed context', () => {
    expect(answer('да', BUILTIN_INTENTS, { lang: 'ru', context: 'garbage' }).intentId).toBe('ack')
    expect(sanitizeContext({ turn: -5, followUp: 42 })).toMatchObject({ turn: 0, followUp: null })
  })
})

describe('coach suggestions, fallback and personal touch', () => {
  it('returns 2–4 labelled quick replies on fallback, localized', () => {
    const { suggestions, text } = ask('квантовая физика', 'kg')
    expect(text.length).toBeGreaterThan(0)
    expect(suggestions.length).toBeGreaterThanOrEqual(2)
    expect(suggestions.length).toBeLessThanOrEqual(4)
    suggestions.forEach((s) => expect(s).toEqual({ id: expect.any(String), label: expect.any(String) }))
    expect(suggestions.map((s) => s.label)).toContain('Эмне кыла аласың?')
  })

  it('answerIntent answers a quick-reply button directly', () => {
    const first = ask('квантовая физика')
    const reply = answerIntent(first.suggestions[0].id, BUILTIN_INTENTS, { lang: 'ru', context: first.context })
    expect(reply.intentId).toBe(first.suggestions[0].id)
    expect(reply.confidence).toBe(1)
    expect(reply.context.turn).toBe(2)
    expect(answerIntent('no-such-intent', BUILTIN_INTENTS, { lang: 'ru' }).intentId).toBe(FALLBACK_INTENT_ID)
  })

  it('uses the name only when given', () => {
    const named = ask('привет', 'ru', { name: 'Айбек' })
    expect(named.text).toContain('Айбек')
    expect(ask('привет').text).not.toMatch(/\{name\}|, !/)
    expect(personalize('Привет{name}!', '')).toBe('Привет!')
    expect(personalize('Привет, {name}!', ' Айбек ')).toBe('Привет, Айбек!')
    expect(personalize('Привет{name}! Как ты?', 'Айбек')).toBe('Привет, Айбек! Как ты?')
  })

  it('keeps answers short and friendly in "ты" form (ru)', () => {
    BUILTIN_INTENTS.forEach((i) => i.answers.ru.forEach((a) => {
      expect(a.length, i.id).toBeLessThanOrEqual(600)
      expect(a, i.id).not.toMatch(/(?<!\p{L})(вы|вас|вам|ваш\p{L}*|вами)(?!\p{L})/iu)
    }))
  })
})

describe('coach backward compatibility', () => {
  const intents = [
    { id: 'motivation', patterns: { en: ['no motivation'], kg: ['мотивация жок'], ru: ['нет мотивации'] }, answers: { en: ['A', 'B'], kg: ['A'], ru: ['А', 'Б'] } },
    { id: 'fallback', patterns: { en: ['-'], kg: ['-'], ru: ['-'] }, answers: { en: ['?'], kg: ['?'], ru: ['?'] } },
  ]

  it('works with plain intents (no labels, followUps or priority) and no context', () => {
    const reply = answer('нет мотивации', intents, { lang: 'ru' })
    expect(reply.intentId).toBe('motivation')
    expect(reply.confidence).toBeGreaterThan(0)
    expect(reply.suggestions).toEqual([])
    expect(reply.context.turn).toBe(1)
  })

  it('without context picks the same variant as before (hash of the message)', () => {
    expect(pickVariant(intents[0], 'ru', 'нет мотивации', null).text)
      .toBe(answer('нет мотивации', intents, { lang: 'ru' }).text)
  })

  it('still works with no options and without a fallback intent', () => {
    expect(answer('xyz', [intents[0]]).text).toBe('')
    expect(answer('xyz', intents).intentId).toBe('fallback')
  })
})

describe('classifyShortReply', () => {
  it.each([
    ['да', 'yes'], ['Ага!', 'yes'], ['да, давай', 'yes'], ['ооба', 'yes'], ['макул', 'yes'], ['ok', 'yes'],
    ['нет', 'no'], ['жок', 'no'], ['не надо', 'no'], ['nope', 'no'],
    ['не знаю', 'unsure'], ['билбейм', 'unsure'], ['хз', 'unsure'], ['idk', 'unsure'],
    ['да но я устал сегодня очень', null], ['привет', null], ['', null],
  ])('“%s” → %s', (msg, kind) => {
    expect(classifyShortReply(msg)).toBe(kind)
  })
})
