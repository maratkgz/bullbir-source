// Built-in knowledge library shipped with the app (works offline).
// Admins can add or override entries in Firestore — see useAiLibrary.js.
import universal from './domains/universal.json'
import health from './domains/health.json'
import finance from './domains/finance.json'
import learning from './domains/learning.json'
import career from './domains/career.json'
import programming from './domains/programming.json'
import languages from './domains/languages.json'
import arabic from './domains/arabic.json'
import languageTeacher from './domains/language-teacher.json'
import coach from './coach.json'

export const BUILTIN_DOMAINS = [
  universal, health, finance, learning, career, programming, languages, arabic, languageTeacher,
]
export const BUILTIN_INTENTS = coach.intents
