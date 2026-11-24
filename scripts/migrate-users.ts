// Stage 3: import accounts from a LOCAL Firebase Auth export into our server-only collections.
//
//   firebase auth:export firebase-auth-export.json --format=json --project <id>   (file is gitignored)
//   node scripts/migrate-users.ts firebase-auth-export.json                         (dry run, default)
//   node scripts/migrate-users.ts firebase-auth-export.json --apply                 (emulator only)
//   node scripts/migrate-users.ts firebase-auth-export.json --apply --i-understand-production
//
// Node ≥ 22.18 / 23.6 runs .ts directly (type stripping); on 22.6–22.17 add
// --experimental-strip-types. This file therefore uses only erasable TypeScript and imports no
// project .ts modules (Node would not map their ".js" specifiers); emailKey()/normalizeEmail()
// mirror server/auth/email.ts — a unit test keeps them identical.
//
// Writes, per user, in one transaction (create-only, so re-runs are idempotent):
//   users_auth/{uid}                 same shape as registerPendingUser + legacyPassword
//   auth_emails/{sha256(email:…)}    { uid, createdAt }
//   auth_accounts/google.com:{sub}   { uid, provider, email, linkedAt }
// Never prints password hashes, salts or full email addresses.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const USERS = 'users_auth'
export const EMAILS = 'auth_emails'
export const ACCOUNTS = 'auth_accounts'
const KNOWN_PROVIDERS = new Set(['password', 'google.com', 'phone'])
const BASE64_ANY = /^[A-Za-z0-9+/_-]+={0,2}$/

// ---------------------------------------------------------------- pure helpers (unit-tested)

export function normalizeEmail(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase()
}

export function emailKey(normalized: string): string {
  return createHash('sha256').update(`email:${normalized}`, 'utf8').digest('hex')
}

/** "anna@mail.com" → "a***@mail.com". Safe to print. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***@${email.slice(at + 1)}`
}

/** Canonical standard base64, or null if the value is not base64 at all. */
function toStandardBase64(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || !BASE64_ANY.test(value)) return null
  const body = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (body.length % 4 === 1) return null
  return body + '='.repeat((4 - (body.length % 4)) % 4)
}

type ProviderInfo = { providerId?: unknown; rawId?: unknown; email?: unknown }

/** One record of `firebase auth:export --format=json` (only the fields we use). */
export type ExportedUser = {
  localId?: unknown
  email?: unknown
  emailVerified?: unknown
  passwordHash?: unknown
  salt?: unknown
  displayName?: unknown
  createdAt?: unknown
  lastSignedInAt?: unknown
  disabled?: unknown
  phoneNumber?: unknown
  providerUserInfo?: unknown
}

export type PlannedUser = {
  uid: string
  email: string
  emailKey: string
  emailVerified: boolean
  displayName: string | null
  providers: string[]
  legacyPassword: { hash: string; salt: string } | null
  createdAtMs: number | null
  lastLoginAtMs: number | null
  google: { sub: string; email: string | null } | null
}

export type ImportPlan = {
  total: number
  ready: PlannedUser[]
  withoutEmail: string[] // uids only (phone-only and similar)
  disabled: string[] // uids — not imported, so a disabled account is not silently re-enabled
  invalid: number // records without a usable uid
  duplicateEmails: { masked: string; uids: string[] }[]
}

function msOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

function providerList(value: unknown): ProviderInfo[] {
  return Array.isArray(value) ? value.filter((p): p is ProviderInfo => typeof p === 'object' && p !== null) : []
}

function toPlanned(raw: ExportedUser, uid: string, email: string): PlannedUser {
  const infos = providerList(raw.providerUserInfo)
  const hash = toStandardBase64(raw.passwordHash)
  const salt = toStandardBase64(raw.salt)
  const legacyPassword = hash && salt ? { hash, salt } : null

  const providers = new Set<string>()
  for (const p of infos) if (typeof p.providerId === 'string' && KNOWN_PROVIDERS.has(p.providerId)) providers.add(p.providerId)
  if (legacyPassword) providers.add('password')

  const g = infos.find((p) => p.providerId === 'google.com' && typeof p.rawId === 'string' && p.rawId.length > 0)
  const google = g
    ? { sub: String(g.rawId), email: typeof g.email === 'string' ? normalizeEmail(g.email) : null }
    : null

  return {
    uid,
    email,
    emailKey: emailKey(email),
    emailVerified: raw.emailVerified === true,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim().slice(0, 80) : null,
    providers: [...providers].sort(),
    legacyPassword,
    createdAtMs: msOrNull(raw.createdAt),
    lastLoginAtMs: msOrNull(raw.lastSignedInAt),
    google,
  }
}

/** Pure: decides what to import. No I/O. */
export function planImport(users: readonly ExportedUser[], limit?: number): ImportPlan {
  const slice = typeof limit === 'number' ? users.slice(0, limit) : users
  const plan: ImportPlan = { total: slice.length, ready: [], withoutEmail: [], disabled: [], invalid: 0, duplicateEmails: [] }
  const byEmail = new Map<string, PlannedUser[]>()

  for (const raw of slice) {
    const uid = typeof raw.localId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(raw.localId) ? raw.localId : null
    if (!uid) { plan.invalid++; continue }
    if (raw.disabled === true) { plan.disabled.push(uid); continue }
    const email = typeof raw.email === 'string' ? normalizeEmail(raw.email) : ''
    if (!email.includes('@')) { plan.withoutEmail.push(uid); continue }
    const planned = toPlanned(raw, uid, email)
    byEmail.set(email, [...(byEmail.get(email) ?? []), planned])
  }

  for (const [email, group] of byEmail) {
    if (group.length === 1 && group[0]) plan.ready.push(group[0])
    else plan.duplicateEmails.push({ masked: maskEmail(email), uids: group.map((u) => u.uid) })
  }
  return plan
}

export function parseExport(text: string): ExportedUser[] {
  const data: unknown = JSON.parse(text)
  const users = (data as { users?: unknown })?.users
  if (!Array.isArray(users)) throw new Error('Not a Firebase auth export: expected { "users": [...] }')
  return users.filter((u): u is ExportedUser => typeof u === 'object' && u !== null)
}

// ---------------------------------------------------------------- CLI

export type CliOptions = {
  file: string
  apply: boolean
  limit: number | undefined
  confirmProduction: boolean
  offline: boolean
  project: string | undefined
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = { file: '', apply: false, limit: undefined, confirmProduction: false, offline: false, project: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') opts.apply = true
    else if (a === '--dry-run') opts.apply = false
    else if (a === '--i-understand-production') opts.confirmProduction = true
    else if (a === '--offline') opts.offline = true
    else if (a === '--project') opts.project = argv[++i]
    else if (a === '--limit') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit needs a positive integer')
      opts.limit = n
    } else if (a?.startsWith('--')) throw new Error(`Unknown flag ${a}`)
    else if (a && !opts.file) opts.file = a
    else if (a) throw new Error(`Unexpected argument ${a}`)
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('Use either --dry-run or --apply')
  if (!opts.file) throw new Error('Usage: node scripts/migrate-users.ts <export.json> [--dry-run|--apply] [--limit N] [--offline] [--project ID] [--i-understand-production]')
  if (opts.apply && opts.offline) throw new Error('--offline cannot be combined with --apply')
  return opts
}

/** Production writes need an explicit, separate confirmation flag. */
export function writeRefusal(opts: CliOptions, env: Record<string, string | undefined>): string | null {
  if (!opts.apply) return null
  if (env.FIRESTORE_EMULATOR_HOST) return null
  if (opts.confirmProduction) return null
  return 'Refusing to --apply: FIRESTORE_EMULATOR_HOST is not set, so this would write to a REAL project. '
    + 'Run on the emulator first; for production add --i-understand-production.'
}

type Outcome = 'imported' | 'would_import' | 'exists' | 'email_taken' | 'google_taken' | 'error'

type Db = import('firebase-admin/firestore').Firestore

async function openDb(project: string | undefined): Promise<Db> {
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  const projectId = project ?? process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT
  if (!projectId) throw new Error('Set --project or FIREBASE_PROJECT_ID')
  const name = 'migrate-users'
  const existing = getApps().find((a) => a.name === name)
  // Emulator: no credentials. Production: GOOGLE_APPLICATION_CREDENTIALS → local service-account file.
  const app = existing ?? initializeApp(
    process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { projectId, credential: applicationDefault() },
    name,
  )
  return getFirestore(app)
}

async function importOne(db: Db, u: PlannedUser, write: boolean): Promise<Outcome> {
  const userRef = db.collection(USERS).doc(u.uid)
  const emailRef = db.collection(EMAILS).doc(u.emailKey)
  const googleRef = u.google ? db.collection(ACCOUNTS).doc(`google.com:${u.google.sub}`) : null

  return db.runTransaction(async (tx) => {
    const [user, index, link] = await Promise.all([tx.get(userRef), tx.get(emailRef), googleRef ? tx.get(googleRef) : null])
    if (user.exists) return 'exists'
    const indexUid = index.get('uid')
    if (index.exists && indexUid !== u.uid) return 'email_taken'
    if (link?.exists && link.get('uid') !== u.uid) return 'google_taken'
    if (!write) return 'would_import'

    const ts = new Date()
    if (!index.exists) tx.create(emailRef, { uid: u.uid, createdAt: ts })
    tx.create(userRef, {
      email: u.email,
      emailVerified: u.emailVerified,
      passwordHash: null,
      legacyPassword: u.legacyPassword,
      displayName: u.displayName,
      providers: u.providers,
      status: 'active',
      createdAt: u.createdAtMs ? new Date(u.createdAtMs) : ts,
      updatedAt: ts,
      lastLoginAt: u.lastLoginAtMs ? new Date(u.lastLoginAtMs) : null,
      passwordChangedAt: null,
      importedAt: ts,
      importSource: 'firebase-auth',
    })
    if (googleRef && u.google && !link?.exists) {
      tx.create(googleRef, { uid: u.uid, provider: 'google.com', email: u.google.email ?? u.email, linkedAt: ts })
    }
    return 'imported'
  })
}

function printPlan(plan: ImportPlan, opts: CliOptions): void {
  const out = (line: string) => process.stdout.write(`${line}\n`)
  out(`Mode: ${opts.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}${opts.offline ? ', offline' : ''}`)
  out(`Records read: ${plan.total}`)
  out(`Ready to import: ${plan.ready.length}`)
  out(`  with legacy password: ${plan.ready.filter((u) => u.legacyPassword).length}`)
  out(`  with Google link:     ${plan.ready.filter((u) => u.google).length}`)
  out(`Invalid records (no uid): ${plan.invalid}`)
  out(`Disabled (skipped): ${plan.disabled.length}${plan.disabled.length ? ` → ${plan.disabled.join(', ')}` : ''}`)
  out(`Without email (skipped, phone-only?): ${plan.withoutEmail.length}`)
  for (const uid of plan.withoutEmail) out(`  - ${uid}`)
  out(`Duplicate emails (all skipped): ${plan.duplicateEmails.length}`)
  for (const d of plan.duplicateEmails) out(`  - ${d.masked}: ${d.uids.join(', ')}`)
}

async function main(argv: readonly string[]): Promise<number> {
  const opts = parseArgs(argv)
  const refusal = writeRefusal(opts, process.env)
  if (refusal) { process.stderr.write(`${refusal}\n`); return 2 }

  const plan = planImport(parseExport(await readFile(resolve(opts.file), 'utf8')), opts.limit)
  printPlan(plan, opts)
  if (opts.offline) return 0

  const db = await openDb(opts.project)
  const counts: Record<Outcome, number> = { imported: 0, would_import: 0, exists: 0, email_taken: 0, google_taken: 0, error: 0 }
  const conflicts: string[] = []
  for (const u of plan.ready) {
    let outcome: Outcome
    try {
      outcome = await importOne(db, u, opts.apply)
    } catch (err) {
      outcome = 'error'
      process.stderr.write(`  ! ${u.uid}: ${err instanceof Error ? err.message : 'unknown error'}\n`)
    }
    counts[outcome]++
    if (outcome === 'email_taken' || outcome === 'google_taken') conflicts.push(`${u.uid} (${outcome}, ${maskEmail(u.email)})`)
  }
  process.stdout.write(`\nFirestore results: ${JSON.stringify(counts)}\n`)
  for (const c of conflicts) process.stdout.write(`  conflict: ${c}\n`)
  return counts.error > 0 ? 1 : 0
}

const isEntryPoint = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : 'Failed'}\n`)
      process.exitCode = 1
    },
  )
}
