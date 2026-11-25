// Stage 3 — scripts/migrate-users.ts run as a CLI (child process) against the Firestore emulator,
// then end to end: synthetic export → script → login through the API → argon2 rehash → bridge
// token with the original uid. Project "demo-bullbir" only; the export lives in a temp dir.
import { execFile } from 'node:child_process'
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { resetEnvForTests } from '../../server/env.js'
import { adminDb } from '../../server/firebaseAdmin.js'
import { captureLogs } from '../../server/log.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import { createHandler } from '../../server/router.js'
import { routes } from '../../server/routes/index.js'
import { emailKey, normalizeEmail } from '../../server/auth/email.js'
import { setMailerForTests } from '../../server/auth/mailer.js'
import { setMinResponseMsForTests } from '../../server/auth/pacing.js'
import { resetLegacyParamsForTests } from '../../server/auth/passwordCheck.js'
import { setBreachCheckerForTests } from '../../server/auth/password.js'
import {
  call as rawCall,
  EMULATORS_RUNNING,
  errorCode,
  FIRESTORE_HOST,
  jwtPayload,
  MailBox,
  PROJECT_ID,
  resetEmulators,
  TEST_ENV,
  type CallOptions,
  type FakeResponse,
} from './helpers/authHarness.js'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'migrate-users.ts')
// Under the session scratchpad when available (Windows dev box), else the OS temp dir.
const TEMP_BASE = process.env.MIGRATION_TEST_TMP ?? tmpdir()
const HASH_VARS = ['FIREBASE_HASH_SIGNER_KEY', 'FIREBASE_HASH_SALT_SEPARATOR', 'FIREBASE_HASH_ROUNDS', 'FIREBASE_HASH_MEM_COST'] as const
const SCRIPT_TIMEOUT_MS = 60_000

type HashParams = { signerKey: Buffer; saltSeparator: Buffer; rounds: number; memCost: number }
const PARAMS: HashParams = { signerKey: randomBytes(64), saltSeparator: Buffer.from([0x07]), rounds: 8, memCost: 10 }

function firebaseHash(password: string, salt: Buffer, p: HashParams): string {
  const N = 2 ** p.memCost
  const derived = scryptSync(Buffer.from(password, 'utf8'), Buffer.concat([salt, p.saltSeparator]), 64, {
    N, r: p.rounds, p: 1, maxmem: 256 * N * p.rounds,
  })
  const cipher = createCipheriv('aes-256-ctr', derived.subarray(0, 32), Buffer.alloc(16))
  return Buffer.concat([cipher.update(p.signerKey), cipher.final()]).toString('base64')
}

const toUrlSafe = (b64: string): string => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// ---------------------------------------------------------------- synthetic export

const VERIFIED_PW = 'verified user old password'
const UNVERIFIED_PW = 'unverified user old password'

type Credential = { hash: string; salt: string }
function credential(password: string, urlSafe = false): Credential {
  const salt = randomBytes(16)
  const hash = firebaseHash(password, salt, PARAMS)
  return urlSafe ? { hash: toUrlSafe(hash), salt: toUrlSafe(salt.toString('base64')) } : { hash, salt: salt.toString('base64') }
}

const UID = {
  verified: 'MigVerifiedAAAAAAAAAAAAAAAAA',
  unverified: 'MigUnverifiedAAAAAAAAAAAAAAA',
  google: 'MigGoogleAAAAAAAAAAAAAAAAAAA',
  mismatch: 'MigGoogleMismatchAAAAAAAAAAA',
  phone: 'MigPhoneOnlyAAAAAAAAAAAAAAAA',
  dupA: 'MigDupAAAAAAAAAAAAAAAAAAAAAA',
  dupB: 'MigDupBBBBBBBBBBBBBBBBBBBBBB',
  disabled: 'MigDisabledAAAAAAAAAAAAAAAAA',
} as const

const EMAIL = {
  verified: 'Verified.Person@Example.test',
  unverified: 'unverified.person@example.test',
  google: 'google.person@example.test',
  mismatch: 'mismatch.person@example.test',
  mismatchGoogle: 'someone.else@gmail.test',
  dupA: 'dup.person@example.test',
  dupB: 'DUP.Person@Example.TEST',
  disabled: 'disabled.person@example.test',
} as const
const GOOGLE_SUB = '109876543210987654321'
const UNVERIFIED_GOOGLE_SUB = '200000000000000000001'
const MISMATCH_GOOGLE_SUB = '300000000000000000001'

const CRED = {
  verified: credential(VERIFIED_PW, true), // URL-safe, as some exports have
  unverified: credential(UNVERIFIED_PW),
  mismatch: credential('mismatch user password'),
  dupA: credential('dup a password'),
  dupB: credential('dup b password'),
  disabled: credential('disabled password'),
}

function syntheticExport(): unknown {
  const pw = (c: Credential) => ({ passwordHash: c.hash, salt: c.salt })
  return {
    users: [
      { localId: UID.verified, email: EMAIL.verified, emailVerified: true, ...pw(CRED.verified), displayName: 'Vera',
        createdAt: '1690000000000', lastSignedInAt: '1700000000000',
        providerUserInfo: [{ providerId: 'password', rawId: EMAIL.verified, email: EMAIL.verified }] },
      // Unverified + a Google link with the same email: the link must NOT be imported.
      { localId: UID.unverified, email: EMAIL.unverified, emailVerified: false, ...pw(CRED.unverified),
        createdAt: '1690000000000', providerUserInfo: [
          { providerId: 'password', rawId: EMAIL.unverified },
          { providerId: 'google.com', rawId: UNVERIFIED_GOOGLE_SUB, email: EMAIL.unverified },
        ] },
      { localId: UID.google, email: EMAIL.google, emailVerified: true, displayName: 'Gogi',
        createdAt: '1690000000000', providerUserInfo: [{ providerId: 'google.com', rawId: GOOGLE_SUB, email: EMAIL.google.toUpperCase() }] },
      // Verified, but the Google profile email differs: the link must NOT be imported.
      { localId: UID.mismatch, email: EMAIL.mismatch, emailVerified: true, ...pw(CRED.mismatch),
        providerUserInfo: [
          { providerId: 'password', rawId: EMAIL.mismatch },
          { providerId: 'google.com', rawId: MISMATCH_GOOGLE_SUB, email: EMAIL.mismatchGoogle },
        ] },
      { localId: UID.phone, phoneNumber: '+996555000111', createdAt: '1690000000000',
        providerUserInfo: [{ providerId: 'phone', rawId: '+996555000111' }] },
      { localId: UID.dupA, email: EMAIL.dupA, emailVerified: true, ...pw(CRED.dupA), providerUserInfo: [{ providerId: 'password' }] },
      { localId: UID.dupB, email: EMAIL.dupB, emailVerified: false, ...pw(CRED.dupB), providerUserInfo: [{ providerId: 'password' }] },
      { localId: UID.disabled, email: EMAIL.disabled, emailVerified: true, disabled: true, ...pw(CRED.disabled),
        providerUserInfo: [{ providerId: 'password' }] },
    ],
  }
}

/** Never printed, never in the report: full emails, hashes, salts, the signer key. */
function forbiddenSecrets(): string[] {
  const emails = Object.values(EMAIL).flatMap((e) => [e, normalizeEmail(e)])
  const creds = Object.values(CRED).flatMap((c) => [c.hash, c.salt, toUrlSafe(c.hash), toUrlSafe(c.salt)])
  return [...emails, ...creds, PARAMS.signerKey.toString('base64')]
}

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

async function collectionIds(name: string): Promise<string[]> {
  return (await adminDb().collection(name).get()).docs.map((d) => d.id).sort()
}

type Report = { mode: string; counts: Record<string, number> | null; entries: Array<{ uid: string; maskedEmail: string | null; reason: string }> }

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('scripts/migrate-users.ts on the emulator', () => {
  let savedEnv: Record<string, string | undefined>
  let dir: string
  let exportFile: string
  let handler: ReturnType<typeof createHandler>
  let mail: MailBox
  let restoreQuietLogs: () => void = () => undefined

  const call = (method: string, path: string, opts?: CallOptions): Promise<FakeResponse> => rawCall(handler, method, path, opts)
  const login = (email: string, password: string): Promise<FakeResponse> => call('POST', 'login', { body: { email, password } })

  /** Child env: local emulator + demo project only; reports land in our temp dir (deleted after). */
  function scriptEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      ...process.env, FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST, TMP: dir, TEMP: dir, TMPDIR: dir, ...extra,
    }
    delete env.GOOGLE_APPLICATION_CREDENTIALS
    delete env.FIREBASE_PROJECT_ID
    delete env.GCLOUD_PROJECT
    for (const k of HASH_VARS) delete env[k]
    return env
  }

  const run = (...args: string[]): Promise<ScriptResult> => runScript([exportFile, ...args, '--project', PROJECT_ID], scriptEnv())
  const apply = (): Promise<ScriptResult> => run('--apply')

  /** Output and report never contain full emails / hashes / salts; returns the parsed report. */
  async function expectCleanAndReport(r: ScriptResult): Promise<Report> {
    const out = `${r.stdout}\n${r.stderr}`
    for (const s of forbiddenSecrets()) expect(out, 'script output leaks a secret or full email').not.toContain(s)
    for (const uid of Object.values(UID)) expect(out, 'stdout carries counts only').not.toContain(uid)
    expect(r.reportPath).toBeTruthy()
    const path = r.reportPath as string
    expect(resolve(dirname(path))).toBe(resolve(dir))
    const text = await readFile(path, 'utf8')
    await rm(path, { force: true })
    for (const s of forbiddenSecrets()) expect(text, 'report leaks a secret or full email').not.toContain(s)
    return JSON.parse(text) as Report
  }

  const reasonsByUid = (report: Report): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const e of report.entries) out[e.uid] = [...(out[e.uid] ?? []), e.reason]
    return out
  }

  beforeAll(async () => {
    expect(PROJECT_ID.startsWith('demo-')).toBe(true)
    const keys = [...Object.keys(TEST_ENV), 'VERCEL', ...HASH_VARS]
    savedEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
    Object.assign(process.env, TEST_ENV)
    process.env.VERCEL = '1'
    process.env.FIREBASE_HASH_SIGNER_KEY = PARAMS.signerKey.toString('base64')
    process.env.FIREBASE_HASH_SALT_SEPARATOR = PARAMS.saltSeparator.toString('base64')
    process.env.FIREBASE_HASH_ROUNDS = String(PARAMS.rounds)
    process.env.FIREBASE_HASH_MEM_COST = String(PARAMS.memCost)
    resetEnvForTests()
    resetLegacyParamsForTests()
    await mkdir(TEMP_BASE, { recursive: true })
    dir = await mkdtemp(join(TEMP_BASE, 'bullbir-migration-'))
    exportFile = join(dir, 'firebase-auth-export.json')
    await writeFile(exportFile, JSON.stringify(syntheticExport(), null, 2), 'utf8')
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
    resetLegacyParamsForTests()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await resetEmulators()
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

  it('refuses --apply without a local emulator host, or with a non-demo project', async () => {
    const noEmulator = scriptEnv()
    delete noEmulator.FIRESTORE_EMULATOR_HOST
    const a = await runScript([exportFile, '--apply', '--project', PROJECT_ID], noEmulator)
    expect(a.code).toBe(2)
    expect(a.stderr).toMatch(/Refusing to --apply/)

    const b = await runScript([exportFile, '--apply', '--project', 'bullbir-prod'], scriptEnv())
    expect(b.code).toBe(2)
    expect(b.stderr).toMatch(/Refusing to --apply: the project id does not start with "demo-"/)

    const c = await runScript([exportFile, '--apply', '--project', PROJECT_ID], scriptEnv({ FIRESTORE_EMULATOR_HOST: 'firestore.example.com:443' }))
    expect(c.code).toBe(2)
    for (const name of ['users_auth', 'auth_emails', 'auth_accounts']) expect(await collectionIds(name)).toEqual([])
  }, 2 * SCRIPT_TIMEOUT_MS)

  it('dry run (default) prints counts only, details go to the report, nothing is written', async () => {
    const r = await run()
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toContain('DRY RUN (no writes)')
    expect(r.stdout).toContain('Records read: 8')
    expect(r.stdout).toContain('Ready to import: 4')
    expect(r.stdout).toMatch(/with legacy password: 3/)
    expect(r.stdout).toMatch(/with Google link:\s+1/)
    expect(r.stdout).toMatch(/Google link skipped \(unverified or email mismatch\): 2/)
    expect(r.stdout).toContain('Disabled (skipped): 1')
    expect(r.stdout).toContain('Without email (skipped, phone-only?): 1')
    expect(r.stdout).toContain('Duplicate emails (all skipped): 1')
    expect(r.stdout).toContain('"would_import":4')
    expect(r.stdout).toContain('"google_link_skipped":2')
    const report = await expectCleanAndReport(r)
    expect(report.mode).toBe('dry-run')
    const reasons = reasonsByUid(report)
    expect(reasons[UID.disabled]).toEqual(['disabled'])
    expect(reasons[UID.phone]).toEqual(['no_email'])
    expect(reasons[UID.dupA]).toEqual(['duplicate_email'])
    expect(reasons[UID.dupB]).toEqual(['duplicate_email'])
    expect(reasons[UID.unverified]).toEqual(['google_link_unverified'])
    expect(reasons[UID.mismatch]).toEqual(['google_link_email_mismatch'])
    expect(reasons[UID.verified]).toBeUndefined()
    expect(reasons[UID.google]).toBeUndefined()
    expect(report.entries.find((e) => e.uid === UID.dupA)?.maskedEmail).toBe('d***@example.test')
    for (const name of ['users_auth', 'auth_emails', 'auth_accounts']) expect(await collectionIds(name)).toEqual([])
  }, SCRIPT_TIMEOUT_MS)

  it('--apply writes the expected docs (uids preserved, safe Google links only); a second --apply is idempotent', async () => {
    const r = await apply()
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toContain('APPLY (writes)')
    expect(r.stdout).toContain('"imported":4')
    expect((await expectCleanAndReport(r)).mode).toBe('apply')

    const imported = [UID.google, UID.mismatch, UID.unverified, UID.verified]
    expect(await collectionIds('users_auth')).toEqual([...imported].sort())
    expect(await collectionIds('auth_emails')).toEqual(
      [EMAIL.verified, EMAIL.unverified, EMAIL.google, EMAIL.mismatch].map((e) => emailKey(normalizeEmail(e))).sort())
    // Only the verified + same-email Google link was imported.
    expect(await collectionIds('auth_accounts')).toEqual([`google.com:${GOOGLE_SUB}`])

    const db = adminDb()
    const data = async (uid: string) => (await db.collection('users_auth').doc(uid).get()).data() ?? {}
    const verified = await data(UID.verified)
    expect(verified).toMatchObject({
      email: normalizeEmail(EMAIL.verified), emailVerified: true, passwordHash: null, displayName: 'Vera',
      providers: ['password'], status: 'active', importSource: 'firebase-auth', passwordChangedAt: null,
    })
    // Stored canonical (standard) base64, same bytes as the URL-safe export value.
    const legacy = verified.legacyPassword as { hash: string; salt: string }
    expect(Buffer.from(legacy.hash, 'base64').equals(Buffer.from(CRED.verified.hash, 'base64url'))).toBe(true)
    expect(Buffer.from(legacy.salt, 'base64').equals(Buffer.from(CRED.verified.salt, 'base64url'))).toBe(true)
    expect(verified.createdAt.toMillis()).toBe(1_690_000_000_000)
    expect(verified.lastLoginAt.toMillis()).toBe(1_700_000_000_000)

    // Unverified user with a Google link: no link, 'google.com' not in providers.
    expect(await data(UID.unverified)).toMatchObject({
      emailVerified: false, passwordHash: null, legacyPassword: CRED.unverified, providers: ['password'],
    })
    expect((await db.collection('auth_accounts').doc(`google.com:${UNVERIFIED_GOOGLE_SUB}`).get()).exists).toBe(false)
    // Verified user whose Google email differs: same.
    expect((await data(UID.mismatch)).providers).toEqual(['password'])
    expect((await db.collection('auth_accounts').doc(`google.com:${MISMATCH_GOOGLE_SUB}`).get()).exists).toBe(false)

    expect(await data(UID.google)).toMatchObject({ emailVerified: true, providers: ['google.com'], legacyPassword: null, passwordHash: null })
    expect((await db.collection('auth_accounts').doc(`google.com:${GOOGLE_SUB}`).get()).data())
      .toMatchObject({ uid: UID.google, provider: 'google.com', email: EMAIL.google })
    const pairs = [[UID.verified, EMAIL.verified], [UID.unverified, EMAIL.unverified], [UID.google, EMAIL.google], [UID.mismatch, EMAIL.mismatch]] as const
    for (const [uid, e] of pairs) {
      expect((await db.collection('auth_emails').doc(emailKey(normalizeEmail(e))).get()).get('uid')).toBe(uid)
    }

    const before = (await db.collection('users_auth').doc(UID.verified).get()).updateTime
    const again = await apply()
    expect(again.code, again.stderr).toBe(0)
    expect(again.stdout).toContain('"imported":0')
    expect(again.stdout).toContain('"exists":4')
    await expectCleanAndReport(again)
    expect(await collectionIds('users_auth')).toHaveLength(4)
    expect(await collectionIds('auth_accounts')).toHaveLength(1)
    const after = (await db.collection('users_auth').doc(UID.verified).get()).updateTime
    expect(Boolean(before && after && after.isEqual(before))).toBe(true)
  }, 2 * SCRIPT_TIMEOUT_MS)

  it('end to end: export → script → login → argon2 rehash → bridge token with the original uid', async () => {
    const r0 = await apply()
    expect(r0.code, r0.stderr).toBe(0)
    await expectCleanAndReport(r0)

    expect(errorCode(await login(EMAIL.verified, 'not the old password'))).toBe('invalid_credentials')
    const r = await login(EMAIL.verified, VERIFIED_PW) // mixed case as typed; stored normalized
    expect(r.status, r.text).toBe(200)
    expect(r.json.user).toMatchObject({ uid: UID.verified, emailVerified: true, displayName: 'Vera' })
    const doc = (await adminDb().collection('users_auth').doc(UID.verified).get()).data() ?? {}
    expect(doc.passwordHash).toMatch(/^\$argon2id\$/)
    expect(doc.legacyPassword).toBeNull()
    expect(doc.migratedAt).toBeTruthy()

    const ft = await call('POST', 'firebase-token', { cookie: r.sessionToken })
    expect(ft.status).toBe(200)
    expect(jwtPayload(ft.json.token as string).uid).toBe(UID.verified)

    const r2 = await login(EMAIL.verified, VERIFIED_PW) // now via argon2
    expect((r2.json.user as { uid: string }).uid).toBe(UID.verified)

    // Unverified import: correct password → code; verify keeps the uid.
    expect(errorCode(await login(EMAIL.unverified, UNVERIFIED_PW))).toBe('email_unverified')
    const v = await call('POST', 'verify-email', {
      body: { email: EMAIL.unverified, code: mail.lastCode(normalizeEmail(EMAIL.unverified)), password: UNVERIFIED_PW },
    })
    expect(v.status, v.text).toBe(200)
    expect((v.json.user as { uid: string }).uid).toBe(UID.unverified)
    const vt = await call('POST', 'firebase-token', { cookie: v.sessionToken })
    expect(jwtPayload(vt.json.token as string).uid).toBe(UID.unverified)

    // Skipped records never became accounts.
    expect(errorCode(await login(EMAIL.disabled, 'disabled password'))).toBe('invalid_credentials')
    expect(errorCode(await login(EMAIL.dupA, 'dup a password'))).toBe('invalid_credentials')
  }, 2 * SCRIPT_TIMEOUT_MS)
})
