export const CURRENCIES = {
  KGS: { symbol: 'сом', label: 'KGS' },
  RUB: { symbol: '₽', label: 'RUB' },
  USD: { symbol: '$', label: 'USD' },
}

// App language (en/kg/ru) → BCP 47 locale for Intl.
const MONEY_LOCALES = { en: 'en-US', ru: 'ru-RU', kg: 'ky-KG' }
// ICU has no good KGS sign (ru prints "KGS", newer data prints "⃀"), so the unit is spelled out.
const KGS_UNIT = { en: 'som', ru: 'сом', kg: 'сом' }
const MONEY_DIGITS = { minimumFractionDigits: 0, maximumFractionDigits: 2 }

function currencyFormatter(locale, currency) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...MONEY_DIGITS })
  } catch {
    // Older engines without narrowSymbol.
    return new Intl.NumberFormat(locale, { style: 'currency', currency, ...MONEY_DIGITS })
  }
}

/**
 * Locale-aware money: formatMoney(1234.5, 'KGS', 'ru') → "1 234,5 сом", ('USD', 'en') → "$1,234.5".
 * Unknown currencies fall back to KGS; `lang` is the app language (en | kg | ru), default ru.
 * @param {number|string} amount
 * @param {string} [currency]
 * @param {string} [lang]
 * @returns {string}
 */
export function formatMoney(amount, currency = 'KGS', lang = 'ru') {
  const n = Number(amount)
  const value = Number.isFinite(n) ? n + 0 : 0 // `+ 0` turns -0 into 0
  const code = CURRENCIES[currency] ? currency : 'KGS'
  const locale = MONEY_LOCALES[lang] || MONEY_LOCALES.ru
  if (code !== 'KGS') return currencyFormatter(locale, code).format(value)
  const number = new Intl.NumberFormat(locale, MONEY_DIGITS).format(value)
  return `${number}\u00a0${KGS_UNIT[lang] || KGS_UNIT.ru}`
}

export function toDateKey(date = new Date()) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Convert a Firestore Timestamp | Date | string to a JS Date.
export function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  if (value instanceof Date) return value
  return new Date(value)
}

export function isSameDay(a, b) {
  return toDateKey(a) === toDateKey(b)
}
