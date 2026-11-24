import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EnvError } from '../../server/env.js'
import { emailKey as serverEmailKey, normalizeEmail as serverNormalize } from '../../server/auth/email.js'
import { parseLegacyHashParams, verifyFirebaseScrypt, type LegacyHashParams } from '../../server/auth/legacyHash.js'
import { emailKey, maskEmail, normalizeEmail, parseArgs, planImport, writeRefusal } from '../../scripts/migrate-users.js'

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

  it('plans: providers, legacy password, Google link, phone-only, duplicates, disabled, limit', () => {
    const plan = planImport([
      { localId: 'u1', email: 'A@x.com', emailVerified: true, passwordHash: 'ab-_', salt: 'c2FsdA', createdAt: '1700000000000',
        providerUserInfo: [{ providerId: 'password' }, { providerId: 'google.com', rawId: '1234', email: 'A@x.com' }] },
      { localId: 'u2', phoneNumber: '+996000000000', providerUserInfo: [{ providerId: 'phone' }] },
      { localId: 'u3', email: 'dup@x.com' },
      { localId: 'u4', email: ' DUP@x.com' },
      { localId: 'u5', email: 'off@x.com', disabled: true },
      { email: 'nouid@x.com' },
      { localId: 'u7', email: 'later@x.com' },
    ], 6)

    expect(plan.total).toBe(6)
    expect(plan.ready).toHaveLength(1)
    const u1 = plan.ready[0]
    expect(u1).toMatchObject({
      uid: 'u1', email: 'a@x.com', emailVerified: true, providers: ['google.com', 'password'],
      legacyPassword: { hash: 'ab+/', salt: 'c2FsdA==' }, createdAtMs: 1700000000000,
      google: { sub: '1234', email: 'a@x.com' },
    })
    expect(plan.withoutEmail).toEqual(['u2'])
    expect(plan.duplicateEmails).toEqual([{ masked: 'd***@x.com', uids: ['u3', 'u4'] }])
    expect(plan.disabled).toEqual(['u5'])
    expect(plan.invalid).toBe(1)
  })

  it('is dry-run by default and refuses production writes without confirmation', () => {
    expect(parseArgs(['f.json']).apply).toBe(false)
    expect(() => parseArgs(['f.json', '--apply', '--dry-run'])).toThrow()
    expect(() => parseArgs(['f.json', '--limit', '0'])).toThrow()
    const apply = parseArgs(['f.json', '--apply'])
    expect(writeRefusal(apply, {})).toMatch(/Refusing/)
    expect(writeRefusal(apply, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toBeNull()
    expect(writeRefusal(parseArgs(['f.json', '--apply', '--i-understand-production']), {})).toBeNull()
  })
})
