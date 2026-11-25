import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EnvError } from '../../server/env.js'
import { emailKey as serverEmailKey, normalizeEmail as serverNormalize } from '../../server/auth/email.js'
import { parseLegacyHashParams, verifyFirebaseScrypt, type LegacyHashParams } from '../../server/auth/legacyHash.js'
import {
  emailKey, googleLinkRefusal, maskEmail, normalizeEmail, parseArgs, parseExport, planImport, redactErrorMessage, reportFileName, writeRefusal,
} from '../../scripts/migrate-users.js'

// Random per-run test values — not real Firebase project parameters.
const params: LegacyHashParams = {
  signerKey: randomBytes(64),
  saltSeparator: Buffer.from([0x07]),
  rounds: 8,
  memCost: 10,
}

/** The hashing direction, written independently (dkLen 64, first 32 bytes — as firebase/scrypt does). */
function firebaseHash(password: string, salt: Buffer, p: LegacyHashParams): string {
  const N = 2 ** p.memCost
  const derived = scryptSync(Buffer.from(password, 'utf8'), Buffer.concat([salt, p.saltSeparator]), 64, {
    N, r: p.rounds, p: 1, maxmem: 256 * N * p.rounds,
  })
  const cipher = createCipheriv('aes-256-ctr', derived.subarray(0, 32), Buffer.alloc(16))
  return Buffer.concat([cipher.update(p.signerKey), cipher.final()]).toString('base64')
}

const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('verifyFirebaseScrypt', () => {
  const salt = randomBytes(16)
  const password = 'correct horse battery staple ✓'
  const legacy = { hash: firebaseHash(password, salt, params), salt: salt.toString('base64') }

  it('accepts the right password', async () => {
    expect(await verifyFirebaseScrypt(password, legacy, params)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    expect(await verifyFirebaseScrypt('correct horse battery staple', legacy, params)).toBe(false)
    expect(await verifyFirebaseScrypt(password + ' ', legacy, params)).toBe(false)
  })

  it('accepts URL-safe base64 hash and salt', async () => {
    const urlSafe = { hash: toUrlSafe(legacy.hash), salt: toUrlSafe(legacy.salt) }
    expect(await verifyFirebaseScrypt(password, urlSafe, params)).toBe(true)
  })

  it('rejects when project params differ (signer key, separator, rounds)', async () => {
    expect(await verifyFirebaseScrypt(password, legacy, { ...params, signerKey: randomBytes(64) })).toBe(false)
    expect(await verifyFirebaseScrypt(password, legacy, { ...params, saltSeparator: Buffer.alloc(0) })).toBe(false)
    expect(await verifyFirebaseScrypt(password, legacy, { ...params, rounds: 7 })).toBe(false)
  })

  it('works with Firebase default cost (mem_cost 14, rounds 8) without hitting maxmem', async () => {
    const heavy = { ...params, memCost: 14 }
    const l = { hash: firebaseHash('p@ssw0rd-long', salt, heavy), salt: legacy.salt }
    expect(await verifyFirebaseScrypt('p@ssw0rd-long', l, heavy)).toBe(true)
  })

  it.each([
    ['empty hash', { hash: '', salt: legacy.salt }],
    ['empty salt', { hash: legacy.hash, salt: '' }],
    ['non-base64 hash', { hash: '!!not*base64!!', salt: legacy.salt }],
    ['truncated hash', { hash: legacy.hash.slice(0, 20), salt: legacy.salt }],
    ['impossible base64 length', { hash: 'A', salt: legacy.salt }],
    ['non-string fields', { hash: 42, salt: null } as unknown as { hash: string; salt: string }],
    ['missing record', undefined as unknown as { hash: string; salt: string }],
  ])('returns false (no throw) for %s', async (_label, bad) => {
    await expect(verifyFirebaseScrypt(password, bad, params)).resolves.toBe(false)
  })

  it('returns false (no throw) for bad params or password', async () => {
    await expect(verifyFirebaseScrypt('', legacy, params)).resolves.toBe(false)
    await expect(verifyFirebaseScrypt(password, legacy, { ...params, memCost: 40 })).resolves.toBe(false)
    await expect(verifyFirebaseScrypt(password, legacy, { ...params, rounds: 0 })).resolves.toBe(false)
    await expect(verifyFirebaseScrypt(password, legacy, { ...params, signerKey: Buffer.alloc(0) })).resolves.toBe(false)
    await expect(verifyFirebaseScrypt(password, legacy, undefined as unknown as LegacyHashParams)).resolves.toBe(false)
  })
})

describe('parseLegacyHashParams', () => {
  const env = {
    FIREBASE_HASH_SIGNER_KEY: params.signerKey.toString('base64'),
    FIREBASE_HASH_SALT_SEPARATOR: 'Bw==',
    FIREBASE_HASH_ROUNDS: '8',
    FIREBASE_HASH_MEM_COST: '14',
  }

  it('parses valid values', () => {
    const p = parseLegacyHashParams(env)
    expect(p.signerKey.equals(params.signerKey)).toBe(true)
    expect(p.saltSeparator.equals(Buffer.from([7]))).toBe(true)
    expect(p).toMatchObject({ rounds: 8, memCost: 14 })
  })

  it('accepts URL-safe signer key', () => {
    const p = parseLegacyHashParams({ ...env, FIREBASE_HASH_SIGNER_KEY: toUrlSafe(env.FIREBASE_HASH_SIGNER_KEY) })
    expect(p.signerKey.equals(params.signerKey)).toBe(true)
  })

  it.each([
    ['missing signer key', { ...env, FIREBASE_HASH_SIGNER_KEY: undefined }],
    ['bad signer key', { ...env, FIREBASE_HASH_SIGNER_KEY: 'not base64!' }],
    ['rounds out of range', { ...env, FIREBASE_HASH_ROUNDS: '9' }],
    ['mem cost not a number', { ...env, FIREBASE_HASH_MEM_COST: '14abc' }],
    ['mem cost out of range', { ...env, FIREBASE_HASH_MEM_COST: '15' }],
  ])('throws EnvError without leaking values: %s', (_label, source) => {
    let caught: unknown
    try { parseLegacyHashParams(source) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(EnvError)
    expect(String((caught as Error).message)).not.toContain(env.FIREBASE_HASH_SIGNER_KEY)
  })
})

describe('migrate-users helpers', () => {
  it('emailKey/normalizeEmail match server/auth/email.ts', () => {
    for (const raw of [' Ann@Mail.COM ', 'ｔｅｓｔ@example.org', 'üser@домен.рф']) {
      expect(normalizeEmail(raw)).toBe(serverNormalize(raw))
      expect(emailKey(normalizeEmail(raw))).toBe(serverEmailKey(serverNormalize(raw)))
    }
  })

  it('masks emails', () => {
    expect(maskEmail('anna@mail.com')).toBe('a***@mail.com')
    expect(maskEmail('broken')).toBe('***')
  })

  it('plans: providers, legacy password, Google link, phone-only, duplicates, disabled', () => {
    const plan = planImport([
      { localId: 'u1', email: 'A@x.com', emailVerified: true, passwordHash: 'ab-_', salt: 'c2FsdA', createdAt: '1700000000000',
        providerUserInfo: [{ providerId: 'password' }, { providerId: 'google.com', rawId: '1234', email: 'A@x.com' }] },
      { localId: 'u2', phoneNumber: '+996000000000', providerUserInfo: [{ providerId: 'phone' }] },
      { localId: 'u3', email: 'dup@x.com' },
      { localId: 'u4', email: ' DUP@x.com' },
      { localId: 'u5', email: 'off@x.com', disabled: true },
      { email: 'nouid@x.com' },
      { localId: 'u7', email: 'later@x.com' },
    ])

    expect(plan.total).toBe(7)
    expect(plan.ready.map((u) => u.uid)).toEqual(['u1', 'u7'])
    expect(plan.ready[0]).toMatchObject({
      uid: 'u1', email: 'a@x.com', emailVerified: true, providers: ['google.com', 'password'],
      legacyPassword: { hash: 'ab+/', salt: 'c2FsdA==' }, createdAtMs: 1700000000000,
      google: { sub: '1234', email: 'a@x.com' }, googleLinkSkipped: null,
    })
    expect(plan.withoutEmail).toEqual(['u2'])
    expect(plan.duplicateEmails).toEqual([{ masked: 'd***@x.com', uids: ['u3', 'u4'] }])
    expect(plan.disabled).toEqual(['u5'])
    expect(plan.invalid).toBe(1)
    expect(plan.googleLinkSkipped).toEqual([])
    expect(plan.details).toEqual(expect.arrayContaining([
      { uid: 'u2', maskedEmail: null, reason: 'no_email' },
      { uid: 'u5', maskedEmail: 'o***@x.com', reason: 'disabled' },
      { uid: 'u3', maskedEmail: 'd***@x.com', reason: 'duplicate_email' },
      { uid: 'u4', maskedEmail: 'd***@x.com', reason: 'duplicate_email' },
    ]))
    expect(plan.details).toHaveLength(4)
    expect(JSON.stringify(plan.details)).not.toMatch(/dup@x\.com|off@x\.com/)
  })

  describe('Google link import (account takeover guard)', () => {
    const google = (email: unknown) => ({ providerId: 'google.com', rawId: '999', email })

    it.each([
      [true, 'a@x.com', 'a@x.com', null],
      [true, 'a@x.com', ' A@X.com ', null],
      [false, 'a@x.com', 'a@x.com', 'google_link_unverified'],
      [true, 'a@x.com', 'attacker@x.com', 'google_link_email_mismatch'],
      [true, 'a@x.com', null, 'google_link_email_mismatch'],
    ] as const)('googleLinkRefusal(%s, %s, %s) → %s', (verified, account, gEmail, expected) => {
      expect(googleLinkRefusal(verified, account, gEmail)).toBe(expected)
    })

    it('imports the user but not the link when unverified or emails differ', () => {
      const plan = planImport([
        { localId: 'v1', email: 'victim@x.com', emailVerified: false, providerUserInfo: [google('victim@x.com')] },
        { localId: 'v2', email: 'other@x.com', emailVerified: true, providerUserInfo: [google('attacker@evil.com')] },
        { localId: 'v3', email: 'nog@x.com', emailVerified: true, providerUserInfo: [{ providerId: 'google.com', rawId: '7' }] },
        { localId: 'ok', email: 'Ok@x.com', emailVerified: true, providerUserInfo: [google('ok@X.com')] },
      ])
      const byUid = new Map(plan.ready.map((u) => [u.uid, u]))
      for (const uid of ['v1', 'v2', 'v3']) {
        expect(byUid.get(uid)?.google).toBeNull()
        expect(byUid.get(uid)?.providers).not.toContain('google.com')
      }
      expect(byUid.get('v1')?.googleLinkSkipped).toBe('google_link_unverified')
      expect(byUid.get('v2')?.googleLinkSkipped).toBe('google_link_email_mismatch')
      expect(byUid.get('ok')).toMatchObject({ google: { sub: '999', email: 'ok@x.com' }, providers: ['google.com'], googleLinkSkipped: null })
      expect(plan.googleLinkSkipped).toEqual(['v1', 'v2', 'v3'])
      expect(plan.details).toEqual([
        { uid: 'v1', maskedEmail: 'v***@x.com', reason: 'google_link_unverified' },
        { uid: 'v2', maskedEmail: 'o***@x.com', reason: 'google_link_email_mismatch' },
        { uid: 'v3', maskedEmail: 'n***@x.com', reason: 'google_link_email_mismatch' },
      ])
    })
  })

  it('applies --limit after duplicate detection over the whole file', () => {
    const users = [
      { localId: 'a1', email: 'a@x.com' },
      { localId: 'b1', email: 'b@x.com' },
      { localId: 'c1', email: 'c@x.com' },
      { localId: 'a2', email: 'A@x.com' }, // duplicate of a1, beyond the limit
    ]
    const plan = planImport(users, 2)
    expect(plan.total).toBe(4)
    expect(plan.duplicateEmails).toEqual([{ masked: 'a***@x.com', uids: ['a1', 'a2'] }])
    expect(plan.ready.map((u) => u.uid)).toEqual(['b1', 'c1'])
    expect(plan.limitedOut).toBe(0)
    expect(planImport(users, 1)).toMatchObject({ limitedOut: 1 })
    expect(planImport(users, 1).ready.map((u) => u.uid)).toEqual(['b1'])
  })

  it('is dry-run by default and refuses production writes without confirmation', () => {
    expect(parseArgs(['f.json']).apply).toBe(false)
    expect(() => parseArgs(['f.json', '--apply', '--dry-run'])).toThrow()
    expect(() => parseArgs(['f.json', '--limit', '0'])).toThrow()
    const apply = parseArgs(['f.json', '--apply'])
    const applyDemo = parseArgs(['f.json', '--apply', '--project', 'demo-bullbir'])
    expect(writeRefusal(parseArgs(['f.json']), {})).toBeNull()
    expect(writeRefusal(apply, {})).toMatch(/Refusing to --apply/)
    expect(writeRefusal(applyDemo, {})).toMatch(/Refusing to --apply/)
    for (const host of ['127.0.0.1:8080', 'localhost:8080', '[::1]:8080']) {
      expect(writeRefusal(applyDemo, { FIRESTORE_EMULATOR_HOST: host })).toBeNull()
      expect(writeRefusal(apply, { FIRESTORE_EMULATOR_HOST: host, FIREBASE_PROJECT_ID: 'demo-x' })).toBeNull()
      expect(writeRefusal(apply, { FIRESTORE_EMULATOR_HOST: host, GCLOUD_PROJECT: 'demo-x' })).toBeNull()
    }
    for (const host of ['10.0.0.5:8080', 'firestore.googleapis.com:443', '127.0.0.1', 'localhost:8080.evil.com', '127.0.0.1:8080 ']) {
      expect(writeRefusal(applyDemo, { FIRESTORE_EMULATOR_HOST: host }), host).toMatch(/Refusing to --apply/)
    }
    const realProject = parseArgs(['f.json', '--apply', '--project', 'bullbir-prod'])
    expect(writeRefusal(realProject, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toMatch(/demo-/)
    expect(writeRefusal(apply, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toMatch(/Refusing/)
    expect(writeRefusal(parseArgs(['f.json', '--apply', '--i-understand-production']), {})).toBeNull()
  })

  it('redacts document paths and emails from error messages', () => {
    const msg = 'ALREADY_EXISTS: projects/p/databases/(default)/documents/users_auth/Uid123 and auth_emails/abc123, '
      + 'auth_accounts/google.com:42 for Anna.B@mail.com (cc <x@y.org>)'
    const out = redactErrorMessage(msg)
    for (const secret of ['Uid123', 'abc123', 'google.com:42', 'Anna.B@mail.com', 'x@y.org']) expect(out).not.toContain(secret)
    expect(out).toContain('users_auth/<redacted>')
    expect(out).toContain('auth_accounts/<redacted>')
    expect(out).toContain('<email>')
    expect(redactErrorMessage('deadline exceeded')).toBe('deadline exceeded')
  })

  it('names the report file with a filesystem-safe timestamp', () => {
    const name = reportFileName(new Date('2026-11-25T10:20:30.123Z'))
    expect(name).toBe('bullbir-migration-report-2026-11-25T10-20-30-123Z.json')
    expect(name).not.toMatch(/[:\\/]/)
  })

  it('never echoes file content when the export is not JSON', () => {
    expect(() => parseExport('{"users":[{"email":"leak@x.com"')).toThrow('Export file is not valid JSON')
    expect(() => parseExport('{"nope":1}')).toThrow(/Not a Firebase auth export/)
  })
})
