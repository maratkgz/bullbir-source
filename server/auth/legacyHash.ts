// Verifies password hashes imported from Firebase Authentication ("modified scrypt", stage 3).
// Used once per legacy account: on the first successful login the password is re-hashed with
// argon2id and the legacy hash is deleted.
//
// Algorithm (github.com/firebase/scrypt):
//   key    = scrypt(password, salt || saltSeparator, N = 2^memCost, r = rounds, p = 1)[0..32]
//   result = AES-256-CTR(key, iv = 16 zero bytes).encrypt(signerKey)
//   valid  = result == stored passwordHash   (constant-time)
// scrypt's output is PBKDF2 blocks, so the first 32 bytes are the same for dkLen 32 or 64.
import { createCipheriv, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { z } from 'zod'
import { EnvError } from '../env.js'

export type LegacyHashParams = {
  /** Project-wide "base64_signer_key" from the Firebase Console, decoded. */
  signerKey: Buffer
  /** Project-wide "base64_salt_separator", decoded (usually 1 byte). */
  saltSeparator: Buffer
  /** scrypt r (Firebase "rounds", 1–8). */
  rounds: number
  /** scrypt N = 2^memCost (Firebase "mem_cost", 1–14). */
  memCost: number
}

/** Per-user values from the export (`passwordHash`, `salt`), base64 or base64url. */
export type LegacyPassword = { hash: string; salt: string }

const KEY_BYTES = 32
const IV = Buffer.alloc(16, 0)
const MAX_SIGNER_KEY_BYTES = 1024
const MAX_FIELD_CHARS = 2048
const MAX_PASSWORD_CHARS = 4096
// Node refuses scrypt when 128·N·r exceeds maxmem; leave headroom for its bookkeeping.
const MAXMEM_HEADROOM = 2 * 1024 * 1024

const BASE64_ANY = /^[A-Za-z0-9+/_-]+={0,2}$/

/** Decodes standard or URL-safe base64. Returns null for anything else (never throws). */
export function decodeBase64Loose(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_FIELD_CHARS) return null
  if (!BASE64_ANY.test(value)) return null
  const body = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  if (body.length % 4 === 1) return null // impossible length for base64
  const bytes = Buffer.from(body, 'base64')
  return bytes.length > 0 ? bytes : null
}

function scryptAsync(password: Buffer, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

function isValidParams(p: LegacyHashParams | undefined): p is LegacyHashParams {
  return Boolean(p)
    && Buffer.isBuffer(p?.signerKey) && p.signerKey.length > 0 && p.signerKey.length <= MAX_SIGNER_KEY_BYTES
    && Buffer.isBuffer(p.saltSeparator)
    && Number.isInteger(p.rounds) && p.rounds >= 1 && p.rounds <= 8
    && Number.isInteger(p.memCost) && p.memCost >= 1 && p.memCost <= 14
}

/**
 * True only if `password` matches the imported Firebase hash. Any malformed input (bad base64,
 * empty values, out-of-range params) returns false — it never throws, so a broken record looks
 * exactly like a wrong password to the caller.
 */
export async function verifyFirebaseScrypt(
  password: string,
  legacy: LegacyPassword,
  params: LegacyHashParams,
): Promise<boolean> {
  try {
    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_CHARS) return false
    if (!isValidParams(params)) return false
    const expected = decodeBase64Loose(legacy?.hash)
    const salt = decodeBase64Loose(legacy?.salt)
    if (!expected || !salt) return false

    const N = 2 ** params.memCost
    const key = await scryptAsync(Buffer.from(password, 'utf8'), Buffer.concat([salt, params.saltSeparator]), {
      N,
      r: params.rounds,
      p: 1,
      maxmem: 128 * N * params.rounds + MAXMEM_HEADROOM,
    })
    const cipher = createCipheriv('aes-256-ctr', key, IV)
    const actual = Buffer.concat([cipher.update(params.signerKey), cipher.final()])
    if (actual.length !== expected.length) return false
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- params from env

const base64Field = (allowEmpty: boolean) =>
  z.string().transform((v, ctx) => {
    if (allowEmpty && v === '') return Buffer.alloc(0)
    const bytes = decodeBase64Loose(v)
    if (!bytes) {
      ctx.addIssue({ code: 'custom', message: 'must be base64' })
      return z.NEVER
    }
    return bytes
  })

const intInRange = (min: number, max: number) =>
  z.string().regex(/^\d+$/, { message: 'must be an integer' }).transform(Number).pipe(z.number().int().min(min).max(max))

const paramsSchema = z.object({
  /** Firebase Console → Authentication → Users → ⋮ → Password hash parameters: base64_signer_key */
  FIREBASE_HASH_SIGNER_KEY: base64Field(false),
  /** … base64_salt_separator (usually "Bw==") */
  FIREBASE_HASH_SALT_SEPARATOR: base64Field(true),
  /** … rounds (usually 8) */
  FIREBASE_HASH_ROUNDS: intInRange(1, 8),
  /** … mem_cost (usually 14) */
  FIREBASE_HASH_MEM_COST: intInRange(1, 14),
})

/** Pure parser for the four FIREBASE_HASH_* variables. Throws EnvError naming variables only. */
export function parseLegacyHashParams(source: Record<string, string | undefined>): LegacyHashParams {
  const result = paramsSchema.safeParse(source)
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`))
  }
  const d = result.data
  return {
    signerKey: d.FIREBASE_HASH_SIGNER_KEY,
    saltSeparator: d.FIREBASE_HASH_SALT_SEPARATOR,
    rounds: d.FIREBASE_HASH_ROUNDS,
    memCost: d.FIREBASE_HASH_MEM_COST,
  }
}
