// Plural-form selection for tp(): app language → Intl locale (Kyrgyz is 'ky' in CLDR, 'kg' in the app).
export const PLURAL_LOCALES = { en: 'en', kg: 'ky', ru: 'ru' }

const rulesCache = new Map()

function pluralRules(lang) {
  const locale = PLURAL_LOCALES[lang] || 'en'
  if (!rulesCache.has(locale)) rulesCache.set(locale, new Intl.PluralRules(locale))
  return rulesCache.get(locale)
}

/** CLDR plural category for n in the app language: 'one' | 'few' | 'many' | 'other' | … */
export function pluralCategory(lang, n) {
  return pluralRules(lang).select(Number(n) || 0)
}

/** Plural categories a language distinguishes, e.g. ru → ['one', 'few', 'many', 'other']. */
export function pluralCategories(lang) {
  return pluralRules(lang).resolvedOptions().pluralCategories
}

/**
 * Key to use for `${baseKey}.${category}`, falling back to `${baseKey}.other`.
 * `has(key)` says whether the dictionary has the key; returns null when neither form exists.
 */
export function resolvePluralKey(has, lang, baseKey, n) {
  const exact = `${baseKey}.${pluralCategory(lang, n)}`
  if (has(exact)) return exact
  const other = `${baseKey}.other`
  return has(other) ? other : null
}
