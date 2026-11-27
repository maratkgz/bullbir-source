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
import business from './domains/business.json'
import freelance from './domains/freelance.json'
import mental from './domains/mental.json'
import relationships from './domains/relationships.json'
import social from './domains/social.json'
import creativity from './domains/creativity.json'
import faith from './domains/faith.json'
import relocation from './domains/relocation.json'
import blog from './domains/blog.json'
import volunteering from './domains/volunteering.json'
import home from './domains/home.json'
import coach from './coach.json'

export const BUILTIN_DOMAINS = [
  universal, health, finance, learning, career, programming, languages, arabic, languageTeacher,
  business, freelance, mental, relationships, social, creativity,
  faith, relocation, blog, volunteering, home,
]
export const BUILTIN_INTENTS = coach.intents
