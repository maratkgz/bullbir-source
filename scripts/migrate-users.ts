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
//     — only when the account email is verified AND equals the Google profile email; otherwise an
//       attacker's unverified account for victim@x with the attacker's Google linked would later
//       allow Google sign-in as the victim.
// stdout carries counts only. Per-user details (uid, masked email, reason) go to a 0600 report
// file in the OS temp dir. Never prints password hashes, salts or full email addresses.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const USERS = 'users_auth'
export const EMAILS = 'auth_emails'
export const ACCOUNTS = 'auth_accounts'
const KNOWN_PROVIDERS = new Set(['password', 'google.com', 'phone'])
const BASE64_ANY = /^[A-Za-z0-9+/_-]+={0,2}$/
const EMULATOR_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/
const DEMO_PROJECT_PREFIX = 'demo-'
const REPORT_FILE_MODE = 0o600

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

const DOC_PATH = /\b(users_auth|auth_emails|auth_accounts)\/[^\s'"`,;)\]}]+/g
const EMAIL_LIKE = /[^\s@'"`<>()[\]{},;:]+@[^\s@'"`<>()[\]{},;:]+/g

/** Strips Firestore document ids of our collections and anything email-like from a message. */
export function redactErrorMessage(message: string): string {
  return message.replace(DOC_PATH, '$1/<redacted>').replace(EMAIL_LIKE, '<email>')
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

export type GoogleLinkSkipReason = 'google_link_unverified' | 'google_link_email_mismatch'

export type ReportReason =
  | 'disabled'
  | 'no_email'
  | 'duplicate_email'
  | GoogleLinkSkipReason
  | 'email_taken'
  | 'google_taken'
  | 'error'

export type ReportEntry = { uid: string; maskedEmail: string | null; reason: ReportReason; message?: string }

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
  /** Set when the export had a Google link that we refuse to import. */
  googleLinkSkipped: GoogleLinkSkipReason | null
}

export type ImportPlan = {
  total: number
  ready: PlannedUser[]
  withoutEmail: string[] // uids only (phone-only and similar)
  disabled: string[] // uids — not imported, so a disabled account is not silently re-enabled
  invalid: number // records without a usable uid
  duplicateEmails: { masked: string; uids: string[] }[]
  googleLinkSkipped: string[] // uids (of `ready`) imported WITHOUT their Google link
  limitedOut: number // importable users left out by --limit
  details: ReportEntry[] // per-user reasons — report file only, never stdout
}

/**
 * A Google link may be imported only if the account email is verified and equals the Google
 * profile email (normalized the same way). Returns null when the link is allowed.
 */
export function googleLinkRefusal(emailVerified: boolean, accountEmail: string, googleEmail: string | null): GoogleLinkSkipReason | null {
  if (!emailVerified) return 'google_link_unverified'
  if (googleEmail === null || normalizeEmail(googleEmail) !== normalizeEmail(accountEmail)) return 'google_link_email_mismatch'
  return null
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
  const emailVerified = raw.emailVerified === true

  const g = infos.find((p) => p.providerId === 'google.com' && typeof p.rawId === 'string' && p.rawId.length > 0)
  const candidate = g
    ? { sub: String(g.rawId), email: typeof g.email === 'string' ? normalizeEmail(g.email) : null }
    : null
  const googleLinkSkipped = candidate ? googleLinkRefusal(emailVerified, email, candidate.email) : null
  const google = googleLinkSkipped ? null : candidate

  const providers = new Set<string>()
  for (const p of infos) if (typeof p.providerId === 'string' && KNOWN_PROVIDERS.has(p.providerId)) providers.add(p.providerId)
  if (legacyPassword) providers.add('password')
  if (!google) providers.delete('google.com')

  return {
    uid,
    email,
    emailKey: emailKey(email),
    emailVerified,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim().slice(0, 80) : null,
    providers: [...providers].sort(),
    legacyPassword,
    createdAtMs: msOrNull(raw.createdAt),
    lastLoginAtMs: msOrNull(raw.lastSignedInAt),
    google,
    googleLinkSkipped,
  }
}

function validUid(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null
}

function maskedOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.includes('@') ? maskEmail(normalizeEmail(value)) : null
}

/**
 * Pure: decides what to import. No I/O. Duplicate detection always covers the whole file;
 * `limit` only caps how many of the remaining importable users are taken.
 */
export function planImport(users: readonly ExportedUser[], limit?: number): ImportPlan {
  const details: ReportEntry[] = []
  const withoutEmail: string[] = []
  const disabled: string[] = []
  let invalid = 0
  const byEmail = new Map<string, PlannedUser[]>()

  for (const raw of users) {
    const uid = validUid(raw.localId)
    if (!uid) { invalid++; continue }
    if (raw.disabled === true) {
      disabled.push(uid)
      details.push({ uid, maskedEmail: maskedOrNull(raw.email), reason: 'disabled' })
      continue
    }
    const email = typeof raw.email === 'string' ? normalizeEmail(raw.email) : ''
    if (!email.includes('@')) {
      withoutEmail.push(uid)
      details.push({ uid, maskedEmail: null, reason: 'no_email' })
      continue
    }
    byEmail.set(email, [...(byEmail.get(email) ?? []), toPlanned(raw, uid, email)])
  }

  const importable: PlannedUser[] = []
  const duplicateEmails: ImportPlan['duplicateEmails'] = []
  for (const [email, group] of byEmail) {
    if (group.length === 1 && group[0]) { importable.push(group[0]); continue }
    const masked = maskEmail(email)
    duplicateEmails.push({ masked, uids: group.map((u) => u.uid) })
    for (const u of group) details.push({ uid: u.uid, maskedEmail: masked, reason: 'duplicate_email' })
  }

  const ready = typeof limit === 'number' ? importable.slice(0, limit) : importable
  const googleLinkSkipped: string[] = []
  for (const u of ready) {
    if (!u.googleLinkSkipped) continue
    googleLinkSkipped.push(u.uid)
    details.push({ uid: u.uid, maskedEmail: maskEmail(u.email), reason: u.googleLinkSkipped })
  }

  return {
    total: users.length,
    ready,
    withoutEmail,
    disabled,
    invalid,
    duplicateEmails,
    googleLinkSkipped,
    limitedOut: importable.length - ready.length,
    details,
  }
}

export function parseExport(text: string): ExportedUser[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    // Never echo the parser message: newer Node versions quote a snippet of the file.
    throw new Error('Export file is not valid JSON')
  }
  const users = (data as { users?: unknown })?.users
  if (!Array.isArray(users)) throw new Error('Not a Firebase auth export: expected { "users": [...] }')
  return users.filter((u): u is ExportedUser => typeof u === 'object' && u !== null)
}

/** "bullbir-migration-report-2026-11-25T10-20-30-123Z.json" — safe on every filesystem. */
export function reportFileName(now: Date): string {
  return `bullbir-migration-report-${now.toISOString().replace(/[:.]/g, '-')}.json`
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

type Env = Record<string, string | undefined>

export function resolveProjectId(opts: CliOptions, env: Env): string | undefined {
  return opts.project ?? env.FIREBASE_PROJECT_ID ?? env.GCLOUD_PROJECT
}

/**
 * Writes without --i-understand-production are allowed only against a local emulator
 * (FIRESTORE_EMULATOR_HOST = 127.0.0.1|localhost|[::1]:port) AND a "demo-*" project id.
 */
export function writeRefusal(opts: CliOptions, env: Env): string | null {
  if (!opts.apply || opts.confirmProduction) return null
  const onLocalEmulator = EMULATOR_HOST.test(env.FIRESTORE_EMULATOR_HOST ?? '')
  const demoProject = (resolveProjectId(opts, env) ?? '').startsWith(DEMO_PROJECT_PREFIX)
  if (onLocalEmulator && demoProject) return null
  const why = !onLocalEmulator
    ? 'FIRESTORE_EMULATOR_HOST is not set to a local emulator (127.0.0.1, localhost or [::1] with a port)'
    : `the project id does not start with "${DEMO_PROJECT_PREFIX}"`
  return `Refusing to --apply: ${why}, so this could write to a REAL project. `
    + `Run on the local emulator with a ${DEMO_PROJECT_PREFIX}* project first; for production add --i-understand-production.`
}

type Outcome = 'imported' | 'would_import' | 'exists' | 'email_taken' | 'google_taken' | 'error'
type Counts = Record<Outcome | 'google_link_skipped', number>

type Db = import('firebase-admin/firestore').Firestore

async function openDb(projectId: string | undefined): Promise<Db> {
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
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

/** Counts only — per-user details live in the report file. */
function printPlan(plan: ImportPlan, opts: CliOptions): void {
  const out = (line: string) => process.stdout.write(`${line}\n`)
  out(`Mode: ${opts.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}${opts.offline ? ', offline' : ''}`)
  out(`Records read: ${plan.total}`)
  out(`Ready to import: ${plan.ready.length}`)
  out(`  with legacy password: ${plan.ready.filter((u) => u.legacyPassword).length}`)
  out(`  with Google link:     ${plan.ready.filter((u) => u.google).length}`)
  out(`  Google link skipped (unverified or email mismatch): ${plan.googleLinkSkipped.length}`)
  out(`Not taken because of --limit: ${plan.limitedOut}`)
  out(`Invalid records (no uid): ${plan.invalid}`)
  out(`Disabled (skipped): ${plan.disabled.length}`)
  out(`Without email (skipped, phone-only?): ${plan.withoutEmail.length}`)
  out(`Duplicate emails (all skipped): ${plan.duplicateEmails.length}`)
}

async function writeReport(report: unknown): Promise<string> {
  const path = join(tmpdir(), reportFileName(new Date()))
  // 'wx': never follow/overwrite an existing file; 0600: owner-only (best effort on Windows).
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: REPORT_FILE_MODE, flag: 'wx' })
  return path
}

async function runImport(db: Db, plan: ImportPlan, apply: boolean): Promise<{ counts: Counts; entries: ReportEntry[] }> {
  const counts: Counts = { imported: 0, would_import: 0, exists: 0, email_taken: 0, google_taken: 0, error: 0, google_link_skipped: plan.googleLinkSkipped.length }
  const entries: ReportEntry[] = []
  for (const [i, u] of plan.ready.entries()) {
    let outcome: Outcome
    try {
      outcome = await importOne(db, u, apply)
    } catch (err) {
      outcome = 'error'
      const message = redactErrorMessage(err instanceof Error ? err.message : 'unknown error')
      process.stderr.write(`  ! record ${i + 1}: ${message}\n`)
      entries.push({ uid: u.uid, maskedEmail: maskEmail(u.email), reason: 'error', message })
    }
    counts[outcome]++
    if (outcome === 'email_taken' || outcome === 'google_taken') entries.push({ uid: u.uid, maskedEmail: maskEmail(u.email), reason: outcome })
  }
  return { counts, entries }
}

async function main(argv: readonly string[]): Promise<number> {
  const opts = parseArgs(argv)
  const refusal = writeRefusal(opts, process.env)
  if (refusal) { process.stderr.write(`${refusal}\n`); return 2 }

  const plan = planImport(parseExport(await readFile(resolve(opts.file), 'utf8')), opts.limit)
  printPlan(plan, opts)

  let counts: Counts | null = null
  let entries: ReportEntry[] = []
  if (!opts.offline) {
    const result = await runImport(await openDb(resolveProjectId(opts, process.env)), plan, opts.apply)
    counts = result.counts
    entries = result.entries
    process.stdout.write(`\nFirestore results: ${JSON.stringify(counts)}\n`)
    process.stdout.write(`Conflicts: ${counts.email_taken + counts.google_taken}\n`)
  }

  const reportPath = await writeReport({
    generatedAt: new Date().toISOString(),
    mode: opts.apply ? 'apply' : 'dry-run',
    offline: opts.offline,
    total: plan.total,
    ready: plan.ready.length,
    invalid: plan.invalid,
    limitedOut: plan.limitedOut,
    counts,
    entries: [...plan.details, ...entries],
  })
  process.stdout.write(`Report (per-user details, keep private): ${reportPath}\n`)
  return counts && counts.error > 0 ? 1 : 0
}

const isEntryPoint = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (err: unknown) => {
      process.stderr.write(`${redactErrorMessage(err instanceof Error ? err.message : 'Failed')}\n`)
      process.exitCode = 1
    },
  )
}
