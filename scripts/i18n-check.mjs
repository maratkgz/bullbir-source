// i18n consistency check (npm run i18n:check).
//  (a) every key in en exists in kg and ru and vice versa (base dictionary + all feature packs);
//  (b) every statically known key used in src/**/*.{js,jsx} via t('…') / tp('…', n) exists in every
//      language — tp keys need the plural forms each language uses (Intl.PluralRules categories);
//  (c) exits 1 with a list when anything is missing, 0 otherwise.
// Dynamic keys (t(`x.${y}`)) cannot be checked; their static prefixes are listed as "dynamic, unchecked".
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'
import { pluralCategories } from '../src/data/i18n/plural.js'

export const LANGS = ['en', 'kg', 'ru']

const STATIC_CALL = /\b(tp|t)\(\s*(['"])([^'"\\\n]+)\2/g
const TEMPLATE_CALL = /\b(tp|t)\(\s*`([^`]*)`/g
const TERNARY_CALL = /\b(tp|t)\(\s*[^'"`(),;]*?\?\s*(['"])([^'"\\\n]+)\2\s*:\s*(['"])([^'"\\\n]+)\4/g

const PLURAL_SUFFIX = /\.(zero|one|two|few|many|other)$/

/** False for a plural form the language does not use (e.g. `foo.few` in en), so it isn't demanded there. */
export function isNeededIn(key, lang) {
  const m = key.match(PLURAL_SUFFIX)
  return !m || pluralCategories(lang).includes(m[1])
}

/** Keys present in some language but missing in another: [{ lang, key }]. */
export function findCrossLanguageGaps(dicts, langs = LANGS) {
  const all = new Set(langs.flatMap((l) => Object.keys(dicts[l] || {})))
  const gaps = []
  for (const lang of langs) {
    const dict = dicts[lang] || {}
    for (const key of [...all].sort()) {
      if (!(key in dict) && isNeededIn(key, lang)) gaps.push({ lang, key })
    }
  }
  return gaps
}

/** Extracts translation-key usages from one source text. */
export function scanSource(text) {
  const keys = []
  const dynamic = []
  for (const m of text.matchAll(STATIC_CALL)) keys.push({ key: m[3], plural: m[1] === 'tp' })
  for (const m of text.matchAll(TERNARY_CALL)) {
    keys.push({ key: m[3], plural: m[1] === 'tp' }, { key: m[5], plural: m[1] === 'tp' })
  }
  for (const m of text.matchAll(TEMPLATE_CALL)) {
    const body = m[2]
    const at = body.indexOf('${')
    if (at === -1) keys.push({ key: body, plural: m[1] === 'tp' })
    else dynamic.push(body.slice(0, at))
  }
  return { keys, dynamic }
}

/** Keys a usage needs in one language (plural usages need one key per category). */
export function requiredKeys(usage, lang) {
  if (!usage.plural) return [usage.key]
  return pluralCategories(lang).map((cat) => `${usage.key}.${cat}`)
}

/** Usages whose keys are missing: [{ lang, key, files }]. */
export function findMissingUsedKeys(usages, dicts, langs = LANGS) {
  const missing = new Map()
  for (const { key, plural, file } of usages) {
    for (const lang of langs) {
      for (const needed of requiredKeys({ key, plural }, lang)) {
        if (needed in (dicts[lang] || {})) continue
        const id = `${lang}\u0000${needed}`
        const entry = missing.get(id) || { lang, key: needed, files: new Set() }
        if (file) entry.files.add(file)
        missing.set(id, entry)
      }
    }
  }
  return [...missing.values()]
    .map((e) => ({ ...e, files: [...e.files].sort() }))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.key.localeCompare(b.key))
}

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(full)
    return /\.(js|jsx)$/.test(entry.name) ? [full] : []
  })
}

// The app's modules import each other without extensions (Vite style); let Node resolve them too.
function allowExtensionlessImports() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (err) {
        const fixable = ['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(err?.code)
        if (!fixable || !specifier.startsWith('.')) throw err
        for (const suffix of ['.js', '/index.js']) {
          try {
            return nextResolve(specifier + suffix, context)
          } catch {
            // try the next candidate
          }
        }
        throw err
      }
    },
  })
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  allowExtensionlessImports()
  const { translations } = await import(pathToFileURL(join(root, 'src/data/translations.js')).href)

  const gaps = findCrossLanguageGaps(translations)

  const usages = []
  const dynamic = new Map()
  for (const file of listSourceFiles(join(root, 'src'))) {
    const rel = relative(root, file).replaceAll('\\', '/')
    const result = scanSource(readFileSync(file, 'utf8'))
    result.keys.forEach((u) => usages.push({ ...u, file: rel }))
    result.dynamic.forEach((prefix) => {
      dynamic.set(prefix, (dynamic.get(prefix) || new Set()).add(rel))
    })
  }
  const missingUsed = findMissingUsedKeys(usages, translations)

  const counts = LANGS.map((l) => `${l}=${Object.keys(translations[l]).length}`).join(' ')
  console.log(`i18n:check — keys: ${counts}; ${usages.length} static usages scanned`)

  if (dynamic.size) {
    console.log('\nDynamic keys (unchecked):')
    for (const [prefix, files] of [...dynamic].sort()) {
      console.log(`  ${prefix || '(no static prefix)'}…  in ${[...files].sort().join(', ')}`)
    }
  }
  if (gaps.length) {
    console.log(`\nKeys missing in some language (${gaps.length}):`)
    gaps.forEach(({ lang, key }) => console.log(`  [${lang}] ${key}`))
  }
  if (missingUsed.length) {
    console.log(`\nKeys used in code but missing (${missingUsed.length}):`)
    missingUsed.forEach(({ lang, key, files }) => console.log(`  [${lang}] ${key}  (${files.join(', ')})`))
  }
  if (gaps.length || missingUsed.length) {
    console.log('\ni18n:check FAILED')
    process.exitCode = 1
    return
  }
  console.log('\ni18n:check OK')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
