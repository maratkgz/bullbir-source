// Item typing heuristics for mandala actions (EN / KG / RU), no external NLP:
//   habit     — something repeated ("every day", "3 times a week", "күн сайын")
//   milestone — a one-off result ("pass the exam", "накопить", "тапшыруу")
//   quality   — a trait/rule to keep ("never", "всегда", "эч качан")
import { normalize } from './text'

export const DEFAULT_MINUTES = { habit: 20, milestone: 60, quality: 5 }

// Phrases are matched on normalized text with word boundaries.
const FREQUENCY_PHRASES = [
  'every day', 'each day', 'daily', 'every morning', 'every evening', 'every night', 'every week',
  'each week', 'weekly', 'every month', 'monthly', 'a day', 'per day', 'a week', 'per week', 'times a', 'regularly',
  'каждый день', 'каждое утро', 'каждый вечер', 'каждую неделю', 'каждую ночь', 'ежедневно',
  'еженедельно', 'раз в день', 'раз в неделю', 'раза в неделю', 'раз в месяц', 'по утрам',
  'по вечерам', 'регулярно', 'в день', 'в неделю', 'каждый месяц', 'ежемесячно',
  'күн сайын', 'күнүгө', 'күнүнө', 'ар күнү', 'ар бир күн', 'жума сайын', 'жумасына',
  'эртең менен', 'кечинде', 'үзгүлтүксүз', 'ар дем алыш', 'ай сайын', 'айына',
]
const WEEKLY_PHRASES = [
  'once a week', 'every week', 'each week', 'weekly', 'раз в неделю', 'каждую неделю',
  'еженедельно', 'жума сайын', 'жумасына бир', 'жумасына 1',
  // monthly items map to the lightest frequency we track
  'every month', 'monthly', 'каждый месяц', 'ежемесячно', 'раз в месяц', 'ай сайын', 'айына',
]
const THREE_A_WEEK_RE = /(?:^| )(?:[2-5]|two|three|four|five|два|две|три|четыре|пять|эки|үч|төрт|беш) (?:times|раза|раз|жолу)(?: | .* )(?:week|неделю|жумасына|жума)/u
const THREE_A_WEEK_KG_RE = /(?:^| )жумасына (?:[2-5]|эки|үч|төрт|беш)(?: |$)/u

const QUALITY_PHRASES = [
  'always', 'never', 'всегда', 'никогда', 'эч качан', 'дайыма', 'ар дайым', 'ар дайыма',
]
const QUALITY_STARTS = ['не', 'never', 'don t', 'do not', 'avoid', 'be', 'быть', 'оставаться', 'stay']

// Word prefixes of "result" verbs.
const MILESTONE_STEMS = [
  'pass', 'save', 'launch', 'finish', 'complet', 'buy', 'publish', 'creat', 'build', 'regist',
  'apply', 'choos', 'find', 'reach', 'submit', 'achiev', 'earn', 'open', 'sign up', 'write a',
  'сдат', 'сдал', 'накоп', 'запуст', 'получит', 'купит', 'закончит', 'окончит', 'поступ',
  'пробежат', 'написат', 'создат', 'открыт', 'опубликов', 'найти', 'выпуст', 'заверш', 'достич',
  'набрат', 'сбросит', 'составит', 'выбрат', 'зарегистр', 'подат', 'собрат',
  'тапшыр', 'топто', 'бүтүр', 'аякта', 'сатып ал', 'ачуу', 'ачыңыз', 'түзүү', 'түзүңүз',
  'тандаңыз', 'тандоо', 'жарыяла', 'катталы', 'жыйна', 'ишке киргиз',
]
// Everyday verbs that make an item concrete enough to check.
const CONCRETE_STEMS = [
  'read', 'run', 'walk', 'write', 'train', 'practic', 'study', 'learn', 'cook', 'call', 'meet',
  'sleep', 'drink', 'track', 'review', 'plan', 'record', 'listen', 'repeat', 'solve',
  'чита', 'бега', 'гуля', 'писа', 'трениров', 'практик', 'учит', 'выучит', 'готови', 'звони',
  'встреча', 'спат', 'пить', 'записыва', 'повторя', 'решат', 'слуша', 'планиров', 'вести',
  'оку', 'окуң', 'чурка', 'баса', 'жаз', 'машыг', 'үйрөн', 'жатта', 'укта',
  'ичүү', 'ичиң', 'кайтала', 'чеч', 'угу', 'угуң', 'пландаш', 'жүргүз',
]
const DEADLINE_PHRASES = [
  'by the end', 'until', 'deadline', 'до конца', 'к концу', 'дедлайн', 'срок', 'чейин', 'аягына',
]

const pad = (text) => ` ${normalize(text)} `
const hasPhrase = (padded, list) => list.some((p) => padded.includes(` ${normalize(p)} `))
const hasStem = (padded, list) => list.some((s) => padded.includes(` ${normalize(s)}`))
const startsWith = (padded, list) => list.some((s) => padded.startsWith(` ${normalize(s)} `))

/** True when the text names a repetition (daily, N times a week…). */
export function hasFrequency(text) {
  const p = pad(text)
  return hasPhrase(p, FREQUENCY_PHRASES) || THREE_A_WEEK_RE.test(p) || THREE_A_WEEK_KG_RE.test(p)
}

/**
 * Guesses the kind of a mandala action. `lang` is a hint only — all languages are checked,
 * because users mix them.
 * @param {string} text
 * (an optional second `lang` argument is accepted for API symmetry and ignored)
 * @returns {'habit'|'milestone'|'quality'}
 */
export function inferType(text) {
  const p = pad(text)
  if (!p.trim()) return 'habit'
  if (hasFrequency(text)) return 'habit'
  if (hasPhrase(p, QUALITY_PHRASES) || startsWith(p, QUALITY_STARTS)) return 'quality'
  if (hasStem(p, MILESTONE_STEMS)) return 'milestone'
  return 'habit'
}

/** Frequency of a habit text: '3w' (2-5 times a week), 'weekly' or 'daily' (default). */
export function inferFreq(text) {
  const p = pad(text)
  if (THREE_A_WEEK_RE.test(p) || THREE_A_WEEK_KG_RE.test(p)) return '3w'
  if (hasPhrase(p, WEEKLY_PHRASES)) return 'weekly'
  return 'daily'
}

/** Typical minutes for one session of an item of this type. */
export function defaultMinutes(type) {
  return DEFAULT_MINUTES[type] || DEFAULT_MINUTES.habit
}

/**
 * True when progress on the item can be checked: it has a number, a frequency, a deadline
 * or a concrete verb. "Быть лучше" / "be better" → false (too vague).
 */
export function isCheckable(text) {
  const p = pad(text)
  if (!p.trim()) return false
  if (/\p{N}/u.test(p)) return true
  if (hasFrequency(text) || hasPhrase(p, DEADLINE_PHRASES)) return true
  return hasStem(p, MILESTONE_STEMS) || hasStem(p, CONCRETE_STEMS)
}
