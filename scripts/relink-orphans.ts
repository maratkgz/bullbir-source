// Recovery: people whose Firebase Auth account was DELETED while their data still lives under
// users/{uid}/... get an account in OUR auth system with the SAME uid, so they find their data again.
//
//   node scripts/relink-orphans.ts                                   (dry run, default)
//   node scripts/relink-orphans.ts --apply                           (emulator + demo-* project only)
//   node scripts/relink-orphans.ts --apply --i-understand-production
//   options: --uid <uid> (one person), --limit N, --project ID
//
// An "orphan" is a root profile users/{uid} with no users_auth/{uid} AND no Firebase Auth user with
// that uid. The profile's `email` (written by the old client, ensureUserDoc) becomes the account's
// address, UNVERIFIED: the mailbox may have changed hands, so the person proves it with an email
// code (otp/verify → claimUnverifiedAccount keeps the uid and marks the address verified).
//
// Skipped and reported: orphans without / with an invalid email; several orphans with the same
// address (all of them); an address already held in auth_emails by another uid, or used by another
// Firebase Auth user (conflicts — sort these out by hand).
//
// Writes per orphan, in one create-only transaction (re-runs are idempotent):
//   auth_emails/{sha256(email:…)}  { uid, createdAt }
//   users_auth/{uid}               same shape as scripts/migrate-users.ts, importSource 'orphan-relink'
// stdout: counts only. Per-user details (masked uid + masked email + reason) go to a 0600 report
// file in the OS temp dir. Never prints full uids or email addresses.
//
// Same constraints as migrate-users.ts: erasable TypeScript only, no project .ts imports;
// normalizeEmail()/emailKey()/isValidEmail() mirror server/auth/email.ts (parity-tested).
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const PROFILES = 'users'
export const USERS = 'users_auth'
export const EMAILS = 'auth_emails'
const EMULATOR_HOST = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/
const DEMO_PROJECT_PREFIX = 'demo-'
const REPORT_FILE_MODE = 0o600
const PAGE_SIZE = 300
const LOOKUP_BATCH = 100 // Firebase Auth getUsers() and Firestore getAll() batch size
const MAX_DISPLAY_NAME = 80
const IMPORT_SOURCE = 'orphan-relink'

// ---------------------------------------------------------------- pure helpers (unit-tested)

export function normalizeEmail(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase()
}

export function emailKey(normalized: string): string {
  return createHash('sha256').update(`email:${normalized}`, 'utf8').digest('hex')
}

const emailSchema = z.string().max(254).transform(normalizeEmail).pipe(z.email())

/** Normalized address if the server would accept it (server/auth/email.ts emailSchema), else null. */
export function validEmail(raw: unknown): string | null {
  const r = emailSchema.safeParse(raw)
  return r.success ? r.data : null
}

/** "anna@mail.com" → "a***@mail.com". Safe to print. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${email[0]}***@${email.slice(at + 1)}`
}

/** "AbCdEfGh…" → "AbCd…(28)". Enough to find the record in the console, not to copy it blindly. */
export function maskUid(uid: string): string {
  return uid.length <= 8 ? '***' : `${uid.slice(0, 4)}…(${uid.length})`
}

const DOC_PATH = /\b(users_auth|auth_emails|auth_accounts|users)\/[^\s'"`,;)\]}]+/g
const EMAIL_LIKE = /[^\s@'"`<>()[\]{},;:]+@[^\s@'"`<>()[\]{},;:]+/g

/** Strips Firestore document paths of our collections and anything email-like from a message. */
export function redactErrorMessage(message: string): string {
  return message.replace(DOC_PATH, '$1/<redacted>').replace(EMAIL_LIKE, '<email>')
}

export function reportFileName(now: Date): string {
  return `bullbir-relink-report-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

/** A profile root doc, as read from users/{uid}. */
export type Profile = { uid: string; email: unknown; displayName: unknown; createdAt: unknown }

/** What we know about a profile's uid outside the profile itself. */
export type UidState = { hasAccount: boolean; inFirebaseAuth: boolean }

export type SkipReason = 'no_email' | 'invalid_email' | 'duplicate_email'

export type Orphan = {
  uid: string
  email: string
  emailKey: string
  displayName: string | null
  createdAtMs: number | null
}

export type ReportEntry = { uid: string; maskedEmail: string | null; reason: string; otherUid?: string; message?: string }

export type RelinkPlan = {
  scanned: number
  hasAccount: number
  inFirebaseAuth: number
  orphans: number
  noEmail: number
  invalidEmail: number
  duplicateEmails: number // distinct addresses shared by several orphans
  candidates: Orphan[]
  details: ReportEntry[]
}

function displayNameOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_DISPLAY_NAME) : null
}

/** Firestore Timestamp / Date / epoch ms → ms, only if plausible (past, positive). */
export function createdAtMs(value: unknown, nowMs: number): number | null {
  let ms: number | null = null
  if (value instanceof Date) ms = value.getTime()
  else if (typeof value === 'number') ms = value
  else if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') ms = (value as { toMillis: () => number }).toMillis()
  return ms !== null && Number.isFinite(ms) && ms > 0 && ms <= nowMs ? ms : null
}

/**
 * Pure: decides which profiles are orphans and which of them can be relinked. Duplicate detection
 * covers every orphan scanned; `onlyUid` then narrows what is counted and relinked.
 */
export function planRelink(profiles: readonly Profile[], states: ReadonlyMap<string, UidState>, nowMs: number, onlyUid?: string): RelinkPlan {
  const selected = (uid: string): boolean => onlyUid === undefined || uid === onlyUid
  const plan: RelinkPlan = { scanned: 0, hasAccount: 0, inFirebaseAuth: 0, orphans: 0, noEmail: 0, invalidEmail: 0, duplicateEmails: 0, candidates: [], details: [] }
  const byEmail = new Map<string, Orphan[]>()

  for (const p of profiles) {
    const state = states.get(p.uid) ?? { hasAccount: false, inFirebaseAuth: false }
    const counted = selected(p.uid)
    if (counted) plan.scanned++
    if (state.hasAccount) { if (counted) plan.hasAccount++; continue }
    if (state.inFirebaseAuth) { if (counted) plan.inFirebaseAuth++; continue }
    if (counted) plan.orphans++
    const hasEmail = typeof p.email === 'string' && p.email.trim() !== ''
    const email = hasEmail ? validEmail(p.email) : null
    if (!email) {
      if (!counted) continue
      if (hasEmail) plan.invalidEmail++
      else plan.noEmail++
      plan.details.push({ uid: maskUid(p.uid), maskedEmail: null, reason: hasEmail ? 'invalid_email' : 'no_email' })
      continue
    }
    const orphan: Orphan = { uid: p.uid, email, emailKey: emailKey(email), displayName: displayNameOf(p.displayName), createdAtMs: createdAtMs(p.createdAt, nowMs) }
    byEmail.set(email, [...(byEmail.get(email) ?? []), orphan])
  }

  for (const [email, group] of byEmail) {
    const mine = group.filter((o) => selected(o.uid))
    if (mine.length === 0) continue
    if (group.length === 1) { plan.candidates.push(...mine); continue }
    plan.duplicateEmails++
    for (const o of mine) plan.details.push({ uid: maskUid(o.uid), maskedEmail: maskEmail(email), reason: 'duplicate_email' })
  }
  return plan
}

// ---------------------------------------------------------------- CLI

export type CliOptions = {
  apply: boolean
  confirmProduction: boolean
  limit: number | undefined
  uid: string | undefined
  project: string | undefined
}

const USAGE = 'Usage: node scripts/relink-orphans.ts [--dry-run|--apply] [--uid UID] [--limit N] [--project ID] [--i-understand-production]'
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = { apply: false, confirmProduction: false, limit: undefined, uid: undefined, project: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') opts.apply = true
    else if (a === '--dry-run') opts.apply = false
    else if (a === '--i-understand-production') opts.confirmProduction = true
    else if (a === '--project') opts.project = argv[++i]
    else if (a === '--uid') {
      const v = argv[++i]
      if (!v || !UID_PATTERN.test(v)) throw new Error('--uid needs a uid (letters, digits, _ and -)')
      opts.uid = v
    } else if (a === '--limit') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit needs a positive integer')
      opts.limit = n
    } else throw new Error(`Unexpected argument ${a ?? ''}. ${USAGE}`)
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('Use either --dry-run or --apply')
  return opts
}

type Env = Record<string, string | undefined>

export function resolveProjectId(opts: CliOptions, env: Env): string | undefined {
  return opts.project ?? env.FIREBASE_PROJECT_ID ?? env.GCLOUD_PROJECT
}

/**
 * Both emulators or neither: with only Firestore on the emulator, the Firebase Auth checks would
 * hit a REAL project (and vice versa). Writes without --i-understand-production additionally need
 * local emulator hosts AND a "demo-*" project id.
 */
export function runRefusal(opts: CliOptions, env: Env): string | null {
  const fsHost = env.FIRESTORE_EMULATOR_HOST ?? ''
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST ?? ''
  if (Boolean(fsHost) !== Boolean(authHost)) {
    return 'Refusing to run: set both FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST (emulator) or neither (real project).'
  }
  if (!opts.apply || opts.confirmProduction) return null
  const onLocalEmulator = EMULATOR_HOST.test(fsHost) && EMULATOR_HOST.test(authHost)
  const demoProject = (resolveProjectId(opts, env) ?? '').startsWith(DEMO_PROJECT_PREFIX)
  if (onLocalEmulator && demoProject) return null
  const why = !onLocalEmulator
    ? 'FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are not set to a local emulator (127.0.0.1, localhost or [::1] with a port)'
    : `the project id does not start with "${DEMO_PROJECT_PREFIX}"`
  return `Refusing to --apply: ${why}, so this could write to a REAL project. `
    + `Run on the local emulator with a ${DEMO_PROJECT_PREFIX}* project first; for production add --i-understand-production.`
}

type Db = import('firebase-admin/firestore').Firestore
type AdminAuth = import('firebase-admin/auth').Auth

async function openAdmin(projectId: string | undefined): Promise<{ db: Db; auth: AdminAuth }> {
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  const { getAuth } = await import('firebase-admin/auth')
  if (!projectId) throw new Error('Set --project or FIREBASE_PROJECT_ID')
  const name = 'relink-orphans'
  const existing = getApps().find((a) => a.name === name)
  // Emulator: no credentials. Production: GOOGLE_APPLICATION_CREDENTIALS → local service-account file.
  const app = existing ?? initializeApp(
    process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { projectId, credential: applicationDefault() },
    name,
  )
  return { db: getFirestore(app), auth: getAuth(app) }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function readProfiles(db: Db): Promise<Profile[]> {
  const { FieldPath } = await import('firebase-admin/firestore')
  const profiles: Profile[] = []
  let last: import('firebase-admin/firestore').QueryDocumentSnapshot | undefined
  for (;;) {
    let q = db.collection(PROFILES).orderBy(FieldPath.documentId()).select('email', 'displayName', 'createdAt').limit(PAGE_SIZE)
    if (last) q = q.startAfter(last)
    const page = await q.get()
    for (const d of page.docs) profiles.push({ uid: d.id, email: d.get('email'), displayName: d.get('displayName'), createdAt: d.get('createdAt') })
    if (page.size < PAGE_SIZE) return profiles
    last = page.docs[page.docs.length - 1]
  }
}

async function readUidStates(db: Db, auth: AdminAuth, uids: readonly string[]): Promise<Map<string, UidState>> {
  const states = new Map<string, UidState>()
  for (const batch of chunks(uids, LOOKUP_BATCH)) {
    const refs = batch.map((uid) => db.collection(USERS).doc(uid))
    const [snaps, found] = await Promise.all([
      refs.length ? db.getAll(...refs, { fieldMask: ['status'] }) : Promise.resolve([]),
      auth.getUsers(batch.map((uid) => ({ uid }))),
    ])
    const inAuth = new Set(found.users.map((u) => u.uid))
    for (const snap of snaps) states.set(snap.id, { hasAccount: snap.exists, inFirebaseAuth: inAuth.has(snap.id) })
  }
  return states
}

/** Normalized addresses that belong to some Firebase Auth user → that user's uid. */
async function firebaseUidsByEmail(auth: AdminAuth, emails: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const batch of chunks(emails, LOOKUP_BATCH)) {
    const found = await auth.getUsers(batch.map((email) => ({ email })))
    for (const u of found.users) if (u.email) out.set(normalizeEmail(u.email), u.uid)
  }
  return out
}

type Outcome = 'relinked' | 'would_relink' | 'exists' | 'email_taken' | 'error'

async function relinkOne(db: Db, o: Orphan, write: boolean): Promise<{ outcome: Outcome; holder?: string }> {
  const userRef = db.collection(USERS).doc(o.uid)
  const emailRef = db.collection(EMAILS).doc(o.emailKey)
  return db.runTransaction(async (tx) => {
    const [user, index] = await Promise.all([tx.get(userRef), tx.get(emailRef)])
    if (user.exists) return { outcome: 'exists' as const }
    const holder: unknown = index.get('uid')
    if (index.exists && holder !== o.uid) return { outcome: 'email_taken' as const, holder: typeof holder === 'string' ? holder : '' }
    if (!write) return { outcome: 'would_relink' as const }
    const ts = new Date()
    if (!index.exists) tx.create(emailRef, { uid: o.uid, createdAt: ts })
    tx.create(userRef, {
      email: o.email,
      emailVerified: false,
      passwordHash: null,
      legacyPassword: null,
      displayName: o.displayName,
      providers: [],
      status: 'active',
      createdAt: o.createdAtMs ? new Date(o.createdAtMs) : ts,
      updatedAt: ts,
      lastLoginAt: null,
      passwordChangedAt: null,
      importSource: IMPORT_SOURCE,
      importedAt: ts,
    })
    return { outcome: 'relinked' as const }
  })
}

type Counts = Record<Outcome | 'email_in_firebase_auth' | 'limited_out', number>

async function runRelink(db: Db, auth: AdminAuth, plan: RelinkPlan, opts: CliOptions): Promise<{ counts: Counts; entries: ReportEntry[] }> {
  const counts: Counts = { relinked: 0, would_relink: 0, exists: 0, email_taken: 0, email_in_firebase_auth: 0, error: 0, limited_out: 0 }
  const entries: ReportEntry[] = []
  const inFirebase = await firebaseUidsByEmail(auth, plan.candidates.map((o) => o.email))
  const ready: Orphan[] = []
  for (const o of plan.candidates) {
    const other = inFirebase.get(o.email)
    if (other === undefined) { ready.push(o); continue }
    counts.email_in_firebase_auth++
    entries.push({ uid: maskUid(o.uid), maskedEmail: maskEmail(o.email), reason: 'email_in_firebase_auth', otherUid: maskUid(other) })
  }
  const taken = opts.limit === undefined ? ready : ready.slice(0, opts.limit)
  counts.limited_out = ready.length - taken.length

  for (const [i, o] of taken.entries()) {
    try {
      const r = await relinkOne(db, o, opts.apply)
      counts[r.outcome]++
      if (r.outcome === 'email_taken') {
        entries.push({ uid: maskUid(o.uid), maskedEmail: maskEmail(o.email), reason: 'email_taken', otherUid: maskUid(r.holder ?? '') })
      } else if (r.outcome !== 'exists') {
        entries.push({ uid: maskUid(o.uid), maskedEmail: maskEmail(o.email), reason: r.outcome })
      }
    } catch (err) {
      counts.error++
      const message = redactErrorMessage(err instanceof Error ? err.message : 'unknown error')
      process.stderr.write(`  ! orphan ${i + 1}: ${message}\n`)
      entries.push({ uid: maskUid(o.uid), maskedEmail: maskEmail(o.email), reason: 'error', message })
    }
  }
  return { counts, entries }
}

function printSummary(plan: RelinkPlan, counts: Counts, opts: CliOptions): void {
  const out = (line: string) => process.stdout.write(`${line}\n`)
  const relinked = opts.apply ? counts.relinked : counts.would_relink
  out(`Mode: ${opts.apply ? 'APPLY (writes)' : 'DRY RUN (no writes)'}${opts.uid ? ', single uid' : ''}`)
  out(`Profiles scanned: ${plan.scanned}`)
  out(`  already in our auth (users_auth exists): ${plan.hasAccount}`)
  out(`  still in Firebase Auth (not orphans): ${plan.inFirebaseAuth}`)
  out(`Orphans found: ${plan.orphans}`)
  out(`${opts.apply ? 'Relinked' : 'Would relink'}: ${relinked}`)
  out(`Conflicts: ${counts.email_taken + counts.email_in_firebase_auth}`)
  out(`  address held by another account (auth_emails): ${counts.email_taken}`)
  out(`  address used by another Firebase Auth user: ${counts.email_in_firebase_auth}`)
  out(`Skipped: ${plan.noEmail + plan.invalidEmail + plan.details.filter((d) => d.reason === 'duplicate_email').length + counts.limited_out}`)
  out(`  without email: ${plan.noEmail}`)
  out(`  invalid email: ${plan.invalidEmail}`)
  out(`  duplicate email (all skipped): ${plan.duplicateEmails}`)
  out(`  not taken because of --limit: ${counts.limited_out}`)
  out(`Already relinked meanwhile: ${counts.exists}`)
  out(`Errors: ${counts.error}`)
}

async function writeReport(report: unknown): Promise<string> {
  const path = join(tmpdir(), reportFileName(new Date()))
  // 'wx': never follow/overwrite an existing file; 0600: owner-only (best effort on Windows).
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: REPORT_FILE_MODE, flag: 'wx' })
  return path
}

async function main(argv: readonly string[]): Promise<number> {
  const opts = parseArgs(argv)
  const refusal = runRefusal(opts, process.env)
  if (refusal) { process.stderr.write(`${refusal}\n`); return 2 }

  const { db, auth } = await openAdmin(resolveProjectId(opts, process.env))
  const profiles = await readProfiles(db)
  const states = await readUidStates(db, auth, profiles.map((p) => p.uid))
  const plan = planRelink(profiles, states, Date.now(), opts.uid)
  const { counts, entries } = await runRelink(db, auth, plan, opts)
  printSummary(plan, counts, opts)

  const reportPath = await writeReport({
    generatedAt: new Date().toISOString(),
    mode: opts.apply ? 'apply' : 'dry-run',
    uid: opts.uid ? maskUid(opts.uid) : null,
    scanned: plan.scanned,
    orphans: plan.orphans,
    counts,
    entries: [...plan.details, ...entries],
  })
  process.stdout.write(`Report (per-user details, keep private): ${reportPath}\n`)
  return counts.error > 0 ? 1 : 0
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
