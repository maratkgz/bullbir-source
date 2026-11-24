// Language-agnostic text utilities for the BullBir assistant (EN / KG / RU).
// No external NLP libraries: normalisation, stop words, prefix stemming and
// character-trigram similarity are enough to match inflected Russian/Kyrgyz forms.

const STOP_WORDS = new Set([
  // en
  'a', 'an', 'the', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'by', 'with', 'my', 'me',
  'i', 'want', 'wanna', 'would', 'like', 'be', 'is', 'am', 'are', 'it', 'this', 'that', 'how',
  'what', 'do', 'can', 'get', 'more', 'some', 'year', 'month', 'week',
  // ru
  'я', 'мне', 'мой', 'моя', 'мое', 'мои', 'хочу', 'хотел', 'хотела', 'бы', 'и', 'или', 'в', 'во',
  'на', 'к', 'ко', 'с', 'со', 'по', 'за', 'до', 'для', 'от', 'о', 'об', 'а', 'но', 'не', 'это',
  'как', 'что', 'чтобы', 'то', 'так', 'же', 'ли', 'мочь', 'могу', 'стать', 'быть', 'год', 'года',
  'месяц', 'неделю', 'больше', 'меньше', 'свой', 'свою', 'свои',
  // kg
  'мен', 'менин', 'мага', 'келет', 'келеби', 'жана', 'же', 'үчүн', 'менен', 'бул', 'ал', 'да',
  'де', 'эле', 'дагы', 'кантип', 'эмне', 'деп', 'болуп', 'болуу', 'жыл', 'ай', 'жума', 'көбүрөөк',
])

const STEM_LENGTH = 5
const TRIGRAM_SIZE = 3

/** Lowercase, ё→е, keep letters/digits (incl. ң ү ө), collapse whitespace. */
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Meaningful words of a text, without stop words. */
export function tokenize(text) {
  const norm = normalize(text)
  if (!norm) return []
  return norm.split(' ').filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
}

/** Crude but language-agnostic stem: the first 5 letters of longer words. */
export function stem(word) {
  return word.length > STEM_LENGTH ? word.slice(0, STEM_LENGTH) : word
}

function trigrams(word) {
  const padded = `_${word}_`
  const grams = new Set()
  for (let i = 0; i <= padded.length - TRIGRAM_SIZE; i++) grams.add(padded.slice(i, i + TRIGRAM_SIZE))
  return grams
}

/** Similarity of two words in [0, 1]: 1 for same word, 0.9 for same stem, else trigram Dice. */
export function wordSimilarity(a, b) {
  if (a === b) return 1
  if (a.length >= 4 && b.length >= 4 && stem(a) === stem(b)) return 0.9
  const ga = trigrams(a)
  const gb = trigrams(b)
  let shared = 0
  ga.forEach((g) => { if (gb.has(g)) shared += 1 })
  return (2 * shared) / (ga.size + gb.size)
}

/** Best similarity of `word` against a list of candidate words. */
export function bestMatch(word, candidates) {
  let best = 0
  for (const c of candidates) {
    const s = wordSimilarity(word, c)
    if (s > best) best = s
    if (best === 1) break
  }
  return best
}
