// Recovery of people deleted from Firebase Auth whose data still exists: scripts/relink-orphans.ts
// run as a CLI (child process) against the Firestore + Auth emulators, then end to end through the
// real router: email-code login → the SAME uid, verified → bridge token → their old data is readable
// under the Firestore rules. Project "demo-bullbir" only; reports land in a temp dir.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { Timestamp } from 'firebase-admin/firestore'
import { resetEnvForTests } from '../../server/env.js'
import { adminAuth, adminDb } from '../../server/firebaseAdmin.js'
import type { ApiRequest, ApiResponse } from '../../server/http.js'
import { captureLogs } from '../../server/log.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import { createHandler } from '../../server/router.js'
import { routes } from '../../server/routes/index.js'
import { emailKey as serverEmailKey, emailSchema, normalizeEmail as serverNormalize } from '../../server/auth/email.js'
import { setMailerForTests, type AuthMail } from '../../server/auth/mailer.js'
import { resolveOAuthAccount } from '../../server/auth/oauth/accounts.js'
import { OAuthError } from '../../server/auth/oauth/provider.js'
import { setMinResponseMsForTests } from '../../server/auth/pacing.js'
import { LOGIN_CODE_DIGITS } from '../../server/routes/otpLogin.js'
import { setBreachCheckerForTests } from '../../server/auth/password.js'
import { emailKey, maskUid, normalizeEmail, validEmail } from '../../scripts/relink-orphans.js'
import {
  AUTH_HOST,
  EMULATORS_RUNNING,
  FIRESTORE_HOST,
  jwtPayload,
  MailBox,
  nextIp,
  ORIGIN,
  PROJECT_ID,
  resetEmulators,
  TEST_ENV,
  UA_CHROME_WIN,
} from './helpers/authHarness.js'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'relink-orphans.ts')
const TEMP_BASE = process.env.MIGRATION_TEST_TMP ?? tmpdir()
const SCRIPT_TIMEOUT_MS = 60_000
const PROFILE_CREATED_MS = 1_690_000_000_000

// ---------------------------------------------------------------- parity with server/auth/email.ts

describe('relink-orphans email helpers mirror server/auth/email.ts', () => {
  const samples = ['Ann@Mail.com ', '  ÅSA@Example.test', 'ｆｕｌｌ＠ｗｉｄｔｈ.test', 'x@y', 'not-an-email', '', 'a@b.c'.padStart(260, 'a')]
  it.each(samples)('%j', (raw) => {
    expect(normalizeEmail(raw)).toBe(serverNormalize(raw))
    expect(emailKey(normalizeEmail(raw))).toBe(serverEmailKey(serverNormalize(raw)))
    const server = emailSchema.safeParse(raw)
    expect(validEmail(raw)).toBe(server.success ? server.data : null)
  })
})

// ---------------------------------------------------------------- seeded world

// The first 4 characters differ per uid: the report shows uids masked as "Xxxx…(28)".
const UID = {
  anna: 'AnnaOrphanAAAAAAAAAAAAAAAAAA', // orphan, will be relinked
  gmail: 'GmaiOrphanAAAAAAAAAAAAAAAAAA', // orphan @gmail.com, will be relinked
  live: 'LiveFirebaseAAAAAAAAAAAAAAAA', // still in Firebase Auth → not an orphan
  linked: 'LinkOursAAAAAAAAAAAAAAAAAAAA', // already in users_auth → not an orphan
  noEmail: 'NoEmOrphanAAAAAAAAAAAAAAAAAA',
  badEmail: 'BadEOrphanAAAAAAAAAAAAAAAAAA',
  dupA: 'DupAOrphanAAAAAAAAAAAAAAAAAA',
  dupB: 'DupBOrphanBBBBBBBBBBBBBBBBBB',
  heldIdx: 'HIdxOrphanAAAAAAAAAAAAAAAAAA', // address held in auth_emails by someone else
  heldFb: 'HFbsOrphanAAAAAAAAAAAAAAAAAA', // address used by another Firebase Auth user
  holderIdx: 'XIdxHolderZZZZZZZZZZZZZZZZZZ',
  holderFb: 'XFbsHolderZZZZZZZZZZZZZZZZZZ',
} as const

const EMAIL = {
  anna: 'Anna.Orphan@Example.test',
  gmail: 'gmail.orphan@gmail.com',
  live: 'live.person@example.test',
  linked: 'linked.person@example.test',
  dupA: 'dup.orphan@example.test',
  dupB: 'DUP.Orphan@Example.TEST',
  heldIdx: 'held.index@example.test',
  heldFb: 'held.firebase@example.test',
} as const

const ALL_UIDS = Object.values(UID)
const ALL_EMAILS = Object.values(EMAIL).flatMap((e) => [e, normalizeEmail(e)])

async function seedWorld(): Promise<void> {
  const db = adminDb()
  const profile = (email: unknown, extra: Record<string, unknown> = {}) => ({
    ...(email === undefined ? {} : { email }), displayName: null, photoURL: null, onboardingDone: true,
    createdAt: Timestamp.fromMillis(PROFILE_CREATED_MS), ...extra,
  })
  const accountDoc = (email: string) => ({
    email, emailVerified: true, passwordHash: null, legacyPassword: null, displayName: null, providers: ['google.com'],
    status: 'active', createdAt: new Date(), updatedAt: new Date(), lastLoginAt: null, passwordChangedAt: null,
  })
  const batch = db.batch()
  batch.set(db.doc(`users/${UID.anna}`), profile(EMAIL.anna, { displayName: '  Anna Orphan ' }))
  batch.set(db.doc(`users/${UID.anna}/tasks/t1`), { title: 'old task of Anna', done: false })
  batch.set(db.doc(`users/${UID.gmail}`), profile(EMAIL.gmail))
  batch.set(db.doc(`users/${UID.gmail}/tasks/t1`), { title: 'old task of Gmail', done: true })
  batch.set(db.doc(`users/${UID.live}`), profile(EMAIL.live))
  batch.set(db.doc(`users/${UID.linked}`), profile(EMAIL.linked))
  batch.set(db.doc(`users_auth/${UID.linked}`), accountDoc(normalizeEmail(EMAIL.linked)))
  batch.set(db.doc(`auth_emails/${emailKey(normalizeEmail(EMAIL.linked))}`), { uid: UID.linked, createdAt: new Date() })
  batch.set(db.doc(`users/${UID.noEmail}`), profile(undefined))
  batch.set(db.doc(`users/${UID.badEmail}`), profile('not-an-email'))
  batch.set(db.doc(`users/${UID.dupA}`), profile(EMAIL.dupA))
  batch.set(db.doc(`users/${UID.dupB}`), profile(EMAIL.dupB))
  batch.set(db.doc(`users/${UID.heldIdx}`), profile(EMAIL.heldIdx))
  batch.set(db.doc(`users_auth/${UID.holderIdx}`), accountDoc(normalizeEmail(EMAIL.heldIdx)))
  batch.set(db.doc(`auth_emails/${emailKey(normalizeEmail(EMAIL.heldIdx))}`), { uid: UID.holderIdx, createdAt: new Date() })
  batch.set(db.doc(`users/${UID.heldFb}`), profile(EMAIL.heldFb))
  await batch.commit()
  await adminAuth().createUser({ uid: UID.live, email: EMAIL.live })
  await adminAuth().createUser({ uid: UID.holderFb, email: EMAIL.heldFb })
}

// ---------------------------------------------------------------- CLI runner

type ScriptResult = { code: number; stdout: string; stderr: string; reportPath: string | null }

function runScript(args: string[], env: Record<string, string | undefined>): Promise<ScriptResult> {
  return new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, env, timeout: SCRIPT_TIMEOUT_MS, windowsHide: true },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
        const out = String(stdout)
        const m = /^Report \(per-user details, keep private\): (.+)$/m.exec(out)
        done({ code, stdout: out, stderr: String(stderr), reportPath: m?.[1]?.trim() ?? null })
      })
  })
}

type Report = { mode: string; counts: Record<string, number>; entries: Array<{ uid: string; maskedEmail: string | null; reason: string; otherUid?: string }> }

// ---------------------------------------------------------------- browser (cookie jar for __Host-otp)

type Res = { status: number; headers: Record<string, string | string[]>; text: string; json: Record<string, unknown> }

class Browser {
  session: string | undefined
  otp: string | undefined
  readonly ip = nextIp()

  cookieHeader(): string | undefined {
    const parts = [this.session ? `__Host-session=${this.session}` : '', this.otp ? `__Host-otp=${this.otp}` : ''].filter(Boolean)
    return parts.length ? parts.join('; ') : undefined
  }

  absorb(cookies: string[]): void {
    for (const c of cookies) {
      const m = /^(__Host-session|__Host-otp)=([^;]*)/.exec(c)
      if (!m) continue
      const value = /Max-Age=0\b/.test(c) || m[2] === '' ? undefined : m[2]
      if (m[1] === '__Host-session') this.session = value
      else this.otp = value
    }
  }
}

async function send(handler: (req: ApiRequest, res: ApiResponse) => Promise<void>, b: Browser, method: string, path: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { 'x-vercel-forwarded-for': b.ip, 'user-agent': UA_CHROME_WIN, origin: ORIGIN }
  const cookie = b.cookieHeader()
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const req = { method, url: `/api/auth/${path}`, headers, body, socket: { remoteAddress: '127.0.0.1' } } as unknown as ApiRequest
  const state = { status: 0, headers: {} as Record<string, string | string[]>, body: '' }
  const res = {
    headersSent: false,
    writableEnded: false,
    get statusCode() { return state.status },
    set statusCode(v: number) { state.status = v },
    setHeader(name: string, value: string | string[]) { state.headers[name.toLowerCase()] = value },
    end(chunk?: string) { state.body = chunk ?? ''; res.writableEnded = true },
    destroy() { res.writableEnded = true },
  }
  await handler(req, res as unknown as ApiResponse)
  const raw = state.headers['set-cookie']
  b.absorb(raw === undefined ? [] : [raw].flat())
  return { status: state.status, headers: state.headers, text: state.body, json: state.body ? (JSON.parse(state.body) as Record<string, unknown>) : {} }
}

/** Client side of the bridge: custom token → Firebase ID token (Auth emulator REST). */
async function idTokenFor(customToken: string): Promise<string> {
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  })
  expect(r.status).toBe(200)
  return ((await r.json()) as { idToken: string }).idToken
}

/** A Firestore read as that client, under firestore.rules (Firestore emulator REST). */
function readAsClient(idToken: string, path: string): Promise<Response> {
  return fetch(`http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`, {
    headers: { authorization: `Bearer ${idToken}` },
  })
}

// ---------------------------------------------------------------- suite

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('scripts/relink-orphans.ts on the emulator', () => {
  let savedEnv: Record<string, string | undefined>
  let dir: string
  let handler: ReturnType<typeof createHandler>
  let mail: MailBox
  let restoreQuietLogs: () => void = () => undefined

  function scriptEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      ...process.env, FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST, FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST,
      TMP: dir, TEMP: dir, TMPDIR: dir, ...extra,
    }
    delete env.GOOGLE_APPLICATION_CREDENTIALS
    delete env.FIREBASE_PROJECT_ID
    delete env.GCLOUD_PROJECT
    return env
  }

  const run = (...args: string[]): Promise<ScriptResult> => runScript([...args, '--project', PROJECT_ID], scriptEnv())

  /** stdout/stderr/report never contain full emails or uids; returns the parsed report. */
  async function expectCleanAndReport(r: ScriptResult): Promise<Report> {
    const out = `${r.stdout}\n${r.stderr}`
    for (const s of [...ALL_EMAILS, ...ALL_UIDS]) expect(out, 'script output leaks an email or uid').not.toContain(s)
    expect(r.reportPath).toBeTruthy()
    const path = r.reportPath as string
    expect(resolve(dirname(path))).toBe(resolve(dir))
    const text = await readFile(path, 'utf8')
    await rm(path, { force: true })
    for (const s of [...ALL_EMAILS, ...ALL_UIDS]) expect(text, 'report leaks an email or uid').not.toContain(s)
    return JSON.parse(text) as Report
  }

  const line = (r: ScriptResult, label: string): number => {
    const m = new RegExp(`^\\s*${label.replace(/[()]/g, '\\$&')}: (\\d+)$`, 'm').exec(r.stdout)
    if (!m) throw new Error(`no line "${label}" in:\n${r.stdout}`)
    return Number(m[1])
  }

  const reasonsByUid = (report: Report): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const e of report.entries) out[e.uid] = [...(out[e.uid] ?? []), e.reason]
    return out
  }

  const ids = async (name: string): Promise<string[]> => (await adminDb().collection(name).get()).docs.map((d) => d.id).sort()
  const userDoc = async (uid: string) => (await adminDb().collection('users_auth').doc(uid).get()).data() ?? {}

  beforeAll(async () => {
    expect(PROJECT_ID.startsWith('demo-')).toBe(true)
    savedEnv = Object.fromEntries([...Object.keys(TEST_ENV), 'VERCEL'].map((k) => [k, process.env[k]]))
    Object.assign(process.env, TEST_ENV)
    process.env.VERCEL = '1'
    resetEnvForTests()
    await mkdir(TEMP_BASE, { recursive: true })
    dir = await mkdtemp(join(TEMP_BASE, 'bullbir-relink-'))
  })

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    setMailerForTests(undefined)
    setBreachCheckerForTests(undefined)
    setMinResponseMsForTests(undefined)
    await Promise.all(getAdminApps().map((a) => deleteAdminApp(a)))
    resetEnvForTests()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await resetEmulators()
    await seedWorld()
    restoreQuietLogs = captureLogs(() => undefined)
    mail = new MailBox()
    setMailerForTests(mail)
    setBreachCheckerForTests(async () => false)
    setMinResponseMsForTests(0)
    const limiter = new MemoryRateLimiter()
    handler = createHandler(routes, { limiter: () => limiter })
  })

  afterEach(() => {
    restoreQuietLogs()
  })

  it('refuses unsafe runs: --apply off the emulator, one emulator only, non-demo project', async () => {
    const noEmulator = scriptEnv()
    delete noEmulator.FIRESTORE_EMULATOR_HOST
    delete noEmulator.FIREBASE_AUTH_EMULATOR_HOST
    const a = await runScript(['--apply', '--project', PROJECT_ID], noEmulator)
    expect(a.code).toBe(2)
    expect(a.stderr).toMatch(/Refusing to --apply/)

    const onlyFirestore = scriptEnv()
    delete onlyFirestore.FIREBASE_AUTH_EMULATOR_HOST
    const b = await runScript(['--project', PROJECT_ID], onlyFirestore) // even a dry run
    expect(b.code).toBe(2)
    expect(b.stderr).toMatch(/set both FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST/)

    const c = await runScript(['--apply', '--project', 'bullbir-prod'], scriptEnv())
    expect(c.code).toBe(2)
    expect(c.stderr).toMatch(/project id does not start with "demo-"/)

    const d = await runScript(['--apply', '--project', PROJECT_ID], scriptEnv({ FIRESTORE_EMULATOR_HOST: 'firestore.example.com:443' }))
    expect(d.code).toBe(2)
    expect(await ids('users_auth')).toEqual([UID.holderIdx, UID.linked].sort())
  }, 4 * SCRIPT_TIMEOUT_MS)

  it('dry run: counts only, details masked in the report, nothing written', async () => {
    const r = await run()
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toContain('DRY RUN (no writes)')
    expect(line(r, 'Profiles scanned')).toBe(10)
    expect(line(r, 'already in our auth (users_auth exists)')).toBe(1)
    expect(line(r, 'still in Firebase Auth (not orphans)')).toBe(1)
    expect(line(r, 'Orphans found')).toBe(8)
    expect(line(r, 'Would relink')).toBe(2)
    expect(line(r, 'Conflicts')).toBe(2)
    expect(line(r, 'address held by another account (auth_emails)')).toBe(1)
    expect(line(r, 'address used by another Firebase Auth user')).toBe(1)
    expect(line(r, 'without email')).toBe(1)
    expect(line(r, 'invalid email')).toBe(1)
    expect(line(r, 'duplicate email (all skipped)')).toBe(1)
    expect(line(r, 'Skipped')).toBe(4)
    expect(line(r, 'Errors')).toBe(0)

    const report = await expectCleanAndReport(r)
    expect(report.mode).toBe('dry-run')
    const reasons = reasonsByUid(report)
    expect(reasons[maskUid(UID.anna)]).toEqual(['would_relink'])
    expect(reasons[maskUid(UID.gmail)]).toEqual(['would_relink'])
    expect(reasons[maskUid(UID.noEmail)]).toEqual(['no_email'])
    expect(reasons[maskUid(UID.badEmail)]).toEqual(['invalid_email'])
    expect(reasons[maskUid(UID.dupA)]).toEqual(['duplicate_email'])
    expect(reasons[maskUid(UID.dupB)]).toEqual(['duplicate_email'])
    expect(reasons[maskUid(UID.live)]).toBeUndefined()
    expect(reasons[maskUid(UID.linked)]).toBeUndefined()
    const held = report.entries.find((e) => e.uid === maskUid(UID.heldIdx))
    expect(held).toMatchObject({ reason: 'email_taken', otherUid: maskUid(UID.holderIdx), maskedEmail: 'h***@example.test' })
    expect(report.entries.find((e) => e.uid === maskUid(UID.heldFb))).toMatchObject({ reason: 'email_in_firebase_auth', otherUid: maskUid(UID.holderFb) })

    expect(await ids('users_auth')).toEqual([UID.holderIdx, UID.linked].sort())
    expect((await ids('auth_emails')).length).toBe(2)
  }, SCRIPT_TIMEOUT_MS)

  it('--apply creates unverified accounts with the OLD uid; conflicts untouched; second run is idempotent', async () => {
    const r = await run('--apply')
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toContain('APPLY (writes)')
    expect(line(r, 'Relinked')).toBe(2)
    expect(line(r, 'Conflicts')).toBe(2)
    expect((await expectCleanAndReport(r)).mode).toBe('apply')

    expect(await ids('users_auth')).toEqual([UID.anna, UID.gmail, UID.holderIdx, UID.linked].sort())
    const anna = await userDoc(UID.anna)
    expect(anna).toMatchObject({
      email: normalizeEmail(EMAIL.anna), emailVerified: false, passwordHash: null, legacyPassword: null,
      displayName: 'Anna Orphan', providers: [], status: 'active', lastLoginAt: null, passwordChangedAt: null,
      importSource: 'orphan-relink',
    })
    expect(anna.createdAt.toMillis()).toBe(PROFILE_CREATED_MS)
    expect(anna.importedAt).toBeTruthy()
    expect((await userDoc(UID.gmail)).displayName).toBeNull()
    const db = adminDb()
    expect((await db.doc(`auth_emails/${emailKey(normalizeEmail(EMAIL.anna))}`).get()).get('uid')).toBe(UID.anna)
    expect((await db.doc(`auth_emails/${emailKey(normalizeEmail(EMAIL.gmail))}`).get()).get('uid')).toBe(UID.gmail)
    expect((await db.doc(`auth_emails/${emailKey(normalizeEmail(EMAIL.heldIdx))}`).get()).get('uid')).toBe(UID.holderIdx)
    expect((await db.doc(`auth_emails/${emailKey(normalizeEmail(EMAIL.heldFb))}`).get()).exists).toBe(false)
    expect((await db.doc(`auth_emails/${emailKey(normalizeEmail(EMAIL.dupA))}`).get()).exists).toBe(false)
    // Profiles and data are not touched.
    expect((await db.doc(`users/${UID.anna}/tasks/t1`).get()).get('title')).toBe('old task of Anna')

    const before = (await db.doc(`users_auth/${UID.anna}`).get()).updateTime
    const again = await run('--apply')
    expect(again.code, again.stderr).toBe(0)
    expect(line(again, 'Relinked')).toBe(0)
    expect(line(again, 'already in our auth (users_auth exists)')).toBe(3)
    expect(line(again, 'Orphans found')).toBe(6)
    await expectCleanAndReport(again)
    const after = (await db.doc(`users_auth/${UID.anna}`).get()).updateTime
    expect(Boolean(before && after && after.isEqual(before))).toBe(true)
    expect(await ids('users_auth')).toHaveLength(4)
  }, 2 * SCRIPT_TIMEOUT_MS)

  it('--uid relinks one person only; --limit caps how many are taken', async () => {
    const limited = await run('--limit', '1')
    expect(limited.code, limited.stderr).toBe(0)
    expect(line(limited, 'Would relink')).toBe(1)
    // 3 reach the limit (Anna, Gmail, and HIdx whose auth_emails conflict shows only in the transaction).
    expect(line(limited, 'not taken because of --limit')).toBe(2)
    await expectCleanAndReport(limited)

    const one = await run('--apply', '--uid', UID.gmail)
    expect(one.code, one.stderr).toBe(0)
    expect(one.stdout).toContain('single uid')
    expect(line(one, 'Profiles scanned')).toBe(1)
    expect(line(one, 'Relinked')).toBe(1)
    expect(line(one, 'Conflicts')).toBe(0)
    await expectCleanAndReport(one)
    expect(await ids('users_auth')).toEqual([UID.gmail, UID.holderIdx, UID.linked].sort())

    // A duplicate stays skipped even when asked for by uid.
    const dup = await run('--apply', '--uid', UID.dupA)
    expect(line(dup, 'Relinked')).toBe(0)
    expect(line(dup, 'duplicate email (all skipped)')).toBe(1)
    await expectCleanAndReport(dup)

    const bad = await runScript(['--uid', 'bad/uid', '--project', PROJECT_ID], scriptEnv())
    expect(bad.code).toBe(1)
  }, 4 * SCRIPT_TIMEOUT_MS)

  it('end to end: relink → email-code login → same uid, verified → bridge token reads the old data', async () => {
    expect((await run('--apply')).code).toBe(0)
    const call = (b: Browser, method: string, path: string, body?: unknown) => send(handler, b, method, path, body)

    // Before the code login: the unverified relinked account cannot be linked to Google.
    const google = { providerId: 'google.com', sub: '104200000000000000001', email: normalizeEmail(EMAIL.gmail), emailVerified: true, name: 'G' }
    const refused = await resolveOAuthAccount(google).then(() => null, (e: unknown) => e)
    expect(refused).toBeInstanceOf(OAuthError)
    expect((refused as OAuthError).reason).toBe('link_unverified')
    expect(await ids('auth_accounts')).toEqual([])

    for (const [uid, email] of [[UID.anna, EMAIL.anna], [UID.gmail, EMAIL.gmail]] as const) {
      const b = new Browser()
      const req = await call(b, 'POST', 'otp/request', { email: email.toUpperCase() })
      expect(req.status).toBe(202)
      expect(b.otp).toBeTruthy()
      const mailed = mail.sent.filter((m): m is Extract<AuthMail, { kind: 'login-code' }> => m.kind === 'login-code' && m.to === normalizeEmail(email))
      const code = mailed[mailed.length - 1]?.code
      expect(code).toBeTruthy()
      const v = await call(b, 'POST', 'otp/verify', { email, code })
      expect(v.status, v.text).toBe(200)
      expect(v.json.user).toMatchObject({ uid, email: normalizeEmail(email), emailVerified: true })
      expect((await userDoc(uid)).emailVerified).toBe(true)

      const ft = await call(b, 'POST', 'firebase-token')
      expect(ft.status).toBe(200)
      const custom = ft.json.token as string
      const payload = jwtPayload(custom)
      expect(payload.uid).toBe(uid)
      expect((payload.claims as { bb_ev?: unknown }).bb_ev).toBe(true)

      const idToken = await idTokenFor(custom)
      const own = await readAsClient(idToken, `users/${uid}/tasks/t1`)
      expect(own.status).toBe(200)
      expect(JSON.stringify(await own.json())).toContain('old task of')
      const other = uid === UID.anna ? UID.gmail : UID.anna
      expect((await readAsClient(idToken, `users/${other}/tasks/t1`)).status).toBe(403)
    }

    // Verified now: Google sign-in for the @gmail.com address links to the SAME (old) uid.
    const linked = await resolveOAuthAccount(google)
    expect(linked).toMatchObject({ uid: UID.gmail, created: false, linked: true })

    // A conflicting orphan was not given an account: its address leads nowhere new.
    const b = new Browser()
    await call(b, 'POST', 'otp/request', { email: EMAIL.heldFb })
    expect(mail.sent.filter((m) => m.to === normalizeEmail(EMAIL.heldFb))).toHaveLength(0)
    const v = await call(b, 'POST', 'otp/verify', { email: EMAIL.heldFb, code: '1'.repeat(LOGIN_CODE_DIGITS) })
    expect(v.status).toBe(400)
    expect((v.json.error as { code?: string } | undefined)?.code).toBe('invalid_code')
  }, 2 * SCRIPT_TIMEOUT_MS)
})
