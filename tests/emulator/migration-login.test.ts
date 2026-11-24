// Stage 3 — lazy migration of accounts imported from Firebase Auth, driven through the real router
// against the Firestore + Auth emulators (project "demo-bullbir" only). Records are seeded exactly
// like scripts/migrate-users.ts writes them: legacyPassword {hash, salt}, passwordHash null.
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { resetEnvForTests } from '../../server/env.js'
import { adminDb } from '../../server/firebaseAdmin.js'
import { captureLogs } from '../../server/log.js'
import { MemoryRateLimiter } from '../../server/rateLimit.js'
import { createHandler } from '../../server/router.js'
import { routes } from '../../server/routes/index.js'
import { randomToken, sha256Hex } from '../../server/auth/crypto.js'
import { emailKey, normalizeEmail } from '../../server/auth/email.js'
import { setMailerForTests } from '../../server/auth/mailer.js'
import { setMinResponseMsForTests } from '../../server/auth/pacing.js'
import { resetLegacyParamsForTests } from '../../server/auth/passwordCheck.js'
import { setBreachCheckerForTests } from '../../server/auth/password.js'
import {
  call as rawCall,
  EMULATORS_RUNNING,
  errorCode,
  jwtPayload,
  MailBox,
  resetEmulators,
  TEST_ENV,
  type CallOptions,
  type FakeResponse,
} from './helpers/authHarness.js'

const OLD_PASSWORD = 'old firebase password 2023'
const WRONG_PASSWORD = 'definitely not the password'
const OWNER_PASSWORD = 'the real owner passphrase 7'
const HASH_VARS = ['FIREBASE_HASH_SIGNER_KEY', 'FIREBASE_HASH_SALT_SEPARATOR', 'FIREBASE_HASH_ROUNDS', 'FIREBASE_HASH_MEM_COST'] as const

type HashParams = { signerKey: Buffer; saltSeparator: Buffer; rounds: number; memCost: number }

// Random per-run values — never real Firebase project parameters. Small mem cost keeps tests fast.
const PARAMS: HashParams = { signerKey: randomBytes(64), saltSeparator: Buffer.from([0x07]), rounds: 8, memCost: 10 }

function hashEnv(p: HashParams): Record<(typeof HASH_VARS)[number], string> {
  return {
    FIREBASE_HASH_SIGNER_KEY: p.signerKey.toString('base64'),
    FIREBASE_HASH_SALT_SEPARATOR: p.saltSeparator.toString('base64'),
    FIREBASE_HASH_ROUNDS: String(p.rounds),
    FIREBASE_HASH_MEM_COST: String(p.memCost),
  }
}

/** Firebase "modified scrypt", hashing direction (as github.com/firebase/scrypt does it). */
function firebaseHash(password: string, salt: Buffer, p: HashParams): string {
  const N = 2 ** p.memCost
  const derived = scryptSync(Buffer.from(password, 'utf8'), Buffer.concat([salt, p.saltSeparator]), 64, {
    N, r: p.rounds, p: 1, maxmem: 256 * N * p.rounds,
  })
  const cipher = createCipheriv('aes-256-ctr', derived.subarray(0, 32), Buffer.alloc(16))
  return Buffer.concat([cipher.update(p.signerKey), cipher.final()]).toString('base64')
}

const toUrlSafe = (b64: string): string => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const suite = EMULATORS_RUNNING ? describe : describe.skip

suite('lazy migration of imported Firebase accounts (emulator)', () => {
  let savedEnv: Record<string, string | undefined>
  let handler: ReturnType<typeof createHandler>
  let mail: MailBox
  let seq = 0
  let restoreQuietLogs: () => void = () => undefined

  const call = (method: string, path: string, opts?: CallOptions): Promise<FakeResponse> => rawCall(handler, method, path, opts)
  const login = (email: string, password: string): Promise<FakeResponse> => call('POST', 'login', { body: { email, password } })
  const freshEmail = (): string => `legacy${Date.now()}x${++seq}@example.test`
  const freshUid = (): string => `Legacy${Date.now()}${++seq}`.padEnd(28, 'x').slice(0, 28)
  const userDoc = async (uid: string) => (await adminDb().collection('users_auth').doc(uid).get()).data() ?? {}

  function setHashEnv(p: HashParams | null): void {
    for (const k of HASH_VARS) delete process.env[k]
    if (p) Object.assign(process.env, hashEnv(p))
    resetEnvForTests()
    resetLegacyParamsForTests()
  }

  type Seeded = { uid: string; email: string; hash: string; salt: string }

  /** Writes users_auth + auth_emails exactly like scripts/migrate-users.ts does. */
  async function seedLegacyUser(opts: {
    email?: string; password?: string; emailVerified?: boolean; urlSafe?: boolean; params?: HashParams
  } = {}): Promise<Seeded> {
    const uid = freshUid()
    const email = normalizeEmail(opts.email ?? freshEmail())
    const saltBytes = randomBytes(16)
    const std = { hash: firebaseHash(opts.password ?? OLD_PASSWORD, saltBytes, opts.params ?? PARAMS), salt: saltBytes.toString('base64') }
    const legacy = opts.urlSafe ? { hash: toUrlSafe(std.hash), salt: toUrlSafe(std.salt) } : std
    const ts = new Date()
    const db = adminDb()
    await db.collection('auth_emails').doc(emailKey(email)).create({ uid, createdAt: ts })
    await db.collection('users_auth').doc(uid).create({
      email,
      emailVerified: opts.emailVerified ?? true,
      passwordHash: null,
      legacyPassword: legacy,
      displayName: 'Imported User',
      providers: ['password'],
      status: 'active',
      createdAt: new Date(1_700_000_000_000),
      updatedAt: ts,
      lastLoginAt: null,
      passwordChangedAt: null,
      importedAt: ts,
      importSource: 'firebase-auth',
    })
    return { uid, email, hash: legacy.hash, salt: legacy.salt }
  }

  function expectMigrated(doc: FirebaseFirestore.DocumentData): void {
    expect(doc.passwordHash).toMatch(/^\$argon2id\$/)
    expect(doc.legacyPassword).toBeNull()
    expect(doc.migratedAt).toBeTruthy()
  }

  beforeAll(() => {
    const keys = [...Object.keys(TEST_ENV), 'VERCEL', ...HASH_VARS]
    savedEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
    Object.assign(process.env, TEST_ENV)
    process.env.VERCEL = '1'
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
  })

  beforeEach(async () => {
    setHashEnv(PARAMS)
    await resetEmulators()
    restoreQuietLogs = captureLogs(() => undefined)
    mail = new MailBox()
    setMailerForTests(mail)
    setBreachCheckerForTests(async () => false) // never the real HIBP
    setMinResponseMsForTests(0)
    const limiter = new MemoryRateLimiter()
    handler = createHandler(routes, { limiter: () => limiter })
  })

  afterEach(() => {
    restoreQuietLogs()
  })

  // ------------------------------------------------------------------ 1. verified import

  describe('imported verified user', () => {
    it('correct password → 200 + session; legacy hash replaced by argon2id; second login via argon2', async () => {
      const u = await seedLegacyUser()
      const first = await login(u.email, OLD_PASSWORD)
      expect(first.status).toBe(200)
      expect(first.sessionToken).toBeTruthy()
      expect(first.json.user).toMatchObject({ uid: u.uid, email: u.email, emailVerified: true })
      expect(first.text).not.toContain(u.hash)

      const doc = await userDoc(u.uid)
      expectMigrated(doc)
      expect(doc.passwordChangedAt).toBeNull() // the password itself did not change
      const argon = doc.passwordHash as string

      const me = await call('GET', 'me', { cookie: first.sessionToken })
      expect(me.status).toBe(200)

      const second = await login(u.email, OLD_PASSWORD)
      expect(second.status).toBe(200)
      expect(second.sessionToken).not.toBe(first.sessionToken)
      expect((await userDoc(u.uid)).passwordHash).toBe(argon) // no re-hash on the argon2 path
      expect((await call('GET', 'me', { cookie: first.sessionToken })).status).toBe(200) // still valid
      expect(mail.sent).toHaveLength(0)
    })

    it('wrong password → invalid_credentials, record untouched, counts toward the lockout', async () => {
      const u = await seedLegacyUser()
      for (let i = 0; i < 4; i++) {
        const r = await login(u.email, WRONG_PASSWORD)
        expect(r.status, `failure #${i + 1}`).toBe(401)
        expect(errorCode(r)).toBe('invalid_credentials')
      }
      const doc = await userDoc(u.uid)
      expect(doc.passwordHash).toBeNull()
      expect(doc.legacyPassword).toEqual({ hash: u.hash, salt: u.salt })

      let locked = await login(u.email, WRONG_PASSWORD)
      if (locked.status !== 429) locked = await login(u.email, WRONG_PASSWORD)
      expect(locked.status).toBe(429)
      expect(errorCode(locked)).toBe('rate_limited')
      // Even the correct legacy password is refused while locked, and nothing migrates.
      expect((await login(u.email, OLD_PASSWORD)).status).toBe(429)
      expect((await userDoc(u.uid)).legacyPassword).not.toBeNull()
    })

    it('URL-safe base64 hash and salt (as some exports have) work', async () => {
      const u = await seedLegacyUser({ urlSafe: true })
      expect(u.hash).not.toMatch(/[+/=]/)
      const r = await login(u.email, OLD_PASSWORD)
      expect(r.status).toBe(200)
      expectMigrated(await userDoc(u.uid))
    })

    it('login is case/space-insensitive for the imported (normalized) address', async () => {
      const u = await seedLegacyUser()
      expect((await login(`  ${u.email.toUpperCase()} `, OLD_PASSWORD)).status).toBe(200)
    })

    it('Firebase default cost (mem_cost 14, rounds 8) verifies and migrates', async () => {
      const heavy: HashParams = { ...PARAMS, memCost: 14, rounds: 8 }
      setHashEnv(heavy)
      const u = await seedLegacyUser({ params: heavy })
      expect((await login(u.email, WRONG_PASSWORD)).status).toBe(401)
      const r = await login(u.email, OLD_PASSWORD)
      expect(r.status).toBe(200)
      expectMigrated(await userDoc(u.uid))
    }, 60_000)
  })

  // ------------------------------------------------------------------ 2. parallel

  it('parallel correct logins: no crash, all succeed, one consistent argon2 hash', async () => {
    const u = await seedLegacyUser()
    const results = await Promise.all([login(u.email, OLD_PASSWORD), login(u.email, OLD_PASSWORD), login(u.email, OLD_PASSWORD)])
    for (const r of results) expect(r.status, r.text).toBe(200)
    expect(new Set(results.map((r) => r.sessionToken)).size).toBe(3)
    const doc = await userDoc(u.uid)
    expectMigrated(doc)
    // Whichever hash won, the stored one verifies the password (next login via argon2).
    expect((await login(u.email, OLD_PASSWORD)).status).toBe(200)
    expect((await userDoc(u.uid)).passwordHash).toBe(doc.passwordHash)
  })

  // ------------------------------------------------------------------ 3. missing params

  it('missing legacy params → invalid_credentials (not 500), an error is logged without secrets', async () => {
    const u = await seedLegacyUser()
    setHashEnv(null)
    const lines: string[] = []
    const restore = captureLogs((l) => lines.push(l))
    let r: FakeResponse
    try {
      r = await login(u.email, OLD_PASSWORD)
    } finally {
      restore()
    }
    expect(r.status).toBe(401)
    expect(errorCode(r)).toBe('invalid_credentials')
    const errors = lines.filter((l) => l.includes('legacy password parameters unavailable'))
    expect(errors).toHaveLength(1)
    expect(JSON.parse(errors[0] as string).level).toBe('error')
    const all = lines.join('\n')
    for (const secret of [OLD_PASSWORD, u.hash, u.salt, PARAMS.signerKey.toString('base64'), u.email]) {
      expect(all).not.toContain(secret)
    }
    const doc = await userDoc(u.uid)
    expect(doc.legacyPassword).toEqual({ hash: u.hash, salt: u.salt })
    expect(doc.passwordHash).toBeNull()

    // Params come back → the same account logs in and migrates.
    setHashEnv(PARAMS)
    expect((await login(u.email, OLD_PASSWORD)).status).toBe(200)
  })

  // ------------------------------------------------------------------ 4. unverified import

  describe('imported unverified user', () => {
    it('correct password → 403 email_unverified + code; verify keeps the same uid', async () => {
      const u = await seedLegacyUser({ emailVerified: false })
      const r = await login(u.email, OLD_PASSWORD)
      expect(r.status).toBe(403)
      expect(errorCode(r)).toBe('email_unverified')
      expect(r.setCookie).toBeUndefined()
      expect(mail.kindsFor(u.email)).toEqual(['verify-code'])
      expect((await adminDb().collection('sessions').where('uid', '==', u.uid).get()).size).toBe(0)

      const v = await call('POST', 'verify-email', { body: { email: u.email, code: mail.lastCode(u.email), password: OLD_PASSWORD } })
      expect(v.status, v.text).toBe(200)
      expect(v.sessionToken).toBeTruthy()
      expect(v.json.user).toMatchObject({ uid: u.uid, email: u.email, emailVerified: true })
      const doc = await userDoc(u.uid)
      expect(doc.emailVerified).toBe(true)
      expect(doc.legacyPassword).toBeNull()
      expect(doc.passwordHash).toMatch(/^\$argon2id\$/)
      expect((await adminDb().collection('users_auth').get()).size).toBe(1) // no second account

      const again = await login(u.email, OLD_PASSWORD)
      expect(again.status).toBe(200)
      expect((again.json.user as { uid: string }).uid).toBe(u.uid)
    })

    it('wrong password → invalid_credentials and no mail', async () => {
      const u = await seedLegacyUser({ emailVerified: false })
      const r = await login(u.email, WRONG_PASSWORD)
      expect(r.status).toBe(401)
      expect(errorCode(r)).toBe('invalid_credentials')
      expect(mail.sent).toHaveLength(0)
      expect((await userDoc(u.uid)).legacyPassword).not.toBeNull()
    })
  })

  // ------------------------------------------------------------------ 5. squatter takeover

  describe('squatter: unverified import of someone else’s address', () => {
    async function plantSession(uid: string): Promise<string> {
      const token = randomToken()
      const t = Date.now()
      await adminDb().collection('sessions').doc(sha256Hex(token)).create({
        uid,
        publicId: 'squatter-session',
        createdAt: new Date(t),
        lastSeenAt: new Date(t),
        idleExpiresAt: new Date(t + 7 * 86_400_000),
        absoluteExpiresAt: new Date(t + 30 * 86_400_000),
        expiresAt: new Date(t + 7 * 86_400_000),
        device: 'Squatter device',
        ipPrefix: '10.0.0',
      })
      return token
    }

    async function ownerTakesOver(email: string): Promise<FakeResponse> {
      const reg = await call('POST', 'register', { body: { email, password: OWNER_PASSWORD } })
      expect(reg.status).toBe(202)
      expect(mail.kindsFor(email)).toEqual(['verify-code']) // not "already-registered"
      return call('POST', 'verify-email', { body: { email, code: mail.lastCode(email), password: OWNER_PASSWORD } })
    }

    it('owner registers + verifies → same uid, owner’s password; squatter’s password and sessions are gone', async () => {
      const u = await seedLegacyUser({ emailVerified: false, password: OLD_PASSWORD })
      const squatterToken = await plantSession(u.uid)
      expect((await call('GET', 'me', { cookie: squatterToken })).status).toBe(200) // planted session is live

      const v = await ownerTakesOver(u.email)
      expect(v.status, v.text).toBe(200)
      expect(v.json.user).toMatchObject({ uid: u.uid, emailVerified: true })

      const doc = await userDoc(u.uid)
      expect(doc.emailVerified).toBe(true)
      expect(doc.legacyPassword).toBeNull()
      expect(doc.passwordHash).toMatch(/^\$argon2id\$/)
      expect(doc.passwordChangedAt).toBeTruthy()

      expect(errorCode(await login(u.email, OLD_PASSWORD))).toBe('invalid_credentials')
      expect((await login(u.email, OWNER_PASSWORD)).status).toBe(200)

      expect((await adminDb().collection('sessions').doc(sha256Hex(squatterToken)).get()).exists).toBe(false)
      expect((await call('GET', 'me', { cookie: squatterToken })).status).toBe(401)
      expect((await call('POST', 'firebase-token', { cookie: squatterToken })).status).toBe(401)
      expect((await call('GET', 'me', { cookie: v.sessionToken })).status).toBe(200)
    })

    it('squatter’s own code (from a correct legacy login) cannot be used with the owner’s password and vice versa', async () => {
      const u = await seedLegacyUser({ emailVerified: false, password: OLD_PASSWORD })
      // The squatter logs in: a code goes to the OWNER's mailbox, which the squatter cannot read.
      expect(errorCode(await login(u.email, OLD_PASSWORD))).toBe('email_unverified')
      const squatterCode = mail.lastCode(u.email)
      // The owner, holding that mail, still needs the password the code was issued for.
      const wrong = await call('POST', 'verify-email', { body: { email: u.email, code: squatterCode, password: OWNER_PASSWORD } })
      expect(wrong.status).toBe(400)
      expect((await userDoc(u.uid)).emailVerified).toBe(false)
    })

    // KNOWN GAP (reported): a Google link imported with the squatter's record survives the takeover,
    // so the squatter's Google account would still sign in to the owner's uid. Flip to `it` once fixed.
    it.fails('takeover also drops a Google link that came with the squatter’s record', async () => {
      const u = await seedLegacyUser({ emailVerified: false })
      const linkRef = adminDb().collection('auth_accounts').doc('google.com:squatter-sub-1')
      await linkRef.create({ uid: u.uid, provider: 'google.com', email: 'squatter@gmail.test', linkedAt: new Date() })
      await adminDb().collection('users_auth').doc(u.uid).update({ providers: ['google.com', 'password'] })

      expect((await ownerTakesOver(u.email)).status).toBe(200)
      const link = await linkRef.get()
      expect(link.exists && link.get('uid') === u.uid).toBe(false)
    })
  })

  // ------------------------------------------------------------------ 7. uid preserved in bridge

  it('custom token from firebase-token for a migrated user carries the original Firebase uid', async () => {
    const u = await seedLegacyUser()
    const r = await login(u.email, OLD_PASSWORD)
    expect(r.status).toBe(200)
    const ft = await call('POST', 'firebase-token', { cookie: r.sessionToken })
    expect(ft.status).toBe(200)
    const payload = jwtPayload(ft.json.token as string)
    expect(payload.uid).toBe(u.uid)
    expect((payload.claims as { bb_ev?: unknown } | undefined)?.bb_ev).toBe(true)
  })
})
