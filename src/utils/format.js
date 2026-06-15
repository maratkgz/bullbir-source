export const CURRENCIES = {
  KGS: { symbol: 'с', label: 'KGS' },
  RUB: { symbol: '₽', label: 'RUB' },
  USD: { symbol: '$', label: 'USD' },
}

export function formatMoney(amount, currency = 'KGS') {
  const c = CURRENCIES[currency] || CURRENCIES.KGS
  const sign = amount < 0 ? '-' : ''
  const value = Math.abs(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${sign}${value} ${c.symbol}`
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
