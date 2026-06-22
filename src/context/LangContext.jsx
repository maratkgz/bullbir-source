import { createContext, useContext, useCallback } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { translations, LANGUAGES, QUOTES } from '../data/translations'

const LangContext = createContext(null)

export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}

function detectLang() {
  if (typeof navigator === 'undefined') return 'en'
  const code = (navigator.language || 'en').slice(0, 2).toLowerCase()
  if (code === 'ky' || code === 'kg') return 'kg'
  if (code === 'ru') return 'ru'
  return 'en'
}

export function LangProvider({ children }) {
  const [lang, setLang] = useLocalStorage('bullbir_lang', detectLang())

  const t = useCallback(
    (key, vars) => {
      const dict = translations[lang] || translations.en
      let str = dict[key] ?? translations.en[key] ?? key
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          str = str.replace(new RegExp(`{${k}}`, 'g'), String(v))
        })
      }
      return str
    },
    [lang],
  )

  // Translate a Firebase error code to the current language.
  const tError = useCallback(
    (err) => {
      const code = typeof err === 'string' ? err : err?.code || 'fb.default'
      const key = code.startsWith('fb.') ? code : `fb.${code}`
      const dict = translations[lang] || translations.en
      return dict[key] ?? dict['fb.default']
    },
    [lang],
  )

  const quote = useCallback(() => {
    const list = QUOTES[lang] || QUOTES.en
    const dayIndex = Math.floor(Date.now() / 86400000) % list.length
    return list[dayIndex]
  }, [lang])

  return (
    <LangContext.Provider value={{ lang, setLang, t, tError, quote, languages: LANGUAGES }}>
      {children}
    </LangContext.Provider>
  )
}
