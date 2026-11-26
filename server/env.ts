// Validates server environment variables once, at first use. The server refuses to run with a
// missing or malformed secret instead of failing in the middle of a user's login.
import { z } from 'zod'

const MIN_PEPPER_BYTES = 32

const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

const base64Bytes = (min: number) =>
  z.string().refine((v) => STRICT_BASE64.test(v) && Buffer.from(v, 'base64').length >= min, {
    message: `must be base64 of at least ${min} random bytes`,
  })

/** An http(s) origin with no path, query or credentials, e.g. https://bullbir.app */
const origin = z.string().refine((v) => {
  try {
    const u = new URL(v)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password
      && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash
  } catch {
    return false
  }
}, { message: 'must be http(s) origins without a path' })

const originList = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(origin).min(1))
  .transform((list) => list.map((u) => new URL(u).origin))

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Deployed origins must be HTTPS and public (cookies are __Host-, Secure). */
const productionOrigins = originList.refine(
  (list) => list.every((o) => { const u = new URL(o); return u.protocol === 'https:' && !LOCAL_HOSTS.has(u.hostname) }),
  { message: 'production origins must be https and not localhost' },
)

const common = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERCEL_ENV: z.enum(['development', 'preview', 'production']).optional(),
  FIREBASE_PROJECT_ID: z.string().min(1),
  /** Comma-separated origins allowed to call the API (CSRF check), e.g. https://bullbir.app */
  APP_ORIGINS: originList,
  /** Storage bucket (e.g. bullbir.firebasestorage.app) — lets the server delete avatars on account deletion. */
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  /** Google sign-in (stage 5). Optional: without them Google answers "unavailable". */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Origin Google redirects back to; must be one of APP_ORIGINS (default: the first one). */
  OAUTH_REDIRECT_BASE: z.string().optional(),
  /** Server-side secret mixed into HMACs of one-time codes. Base64, ≥ 32 random bytes. */
  AUTH_PEPPER: base64Bytes(MIN_PEPPER_BYTES),
})

// Firebase "modified scrypt" parameters (Console → Authentication → Users → ⋮ → Password hash
// parameters) — used to check old passwords once, then they are re-hashed with argon2id.
// Format is validated in server/auth/legacyHash.ts. Optional in the emulator.
const legacyHash = {
  FIREBASE_HASH_SIGNER_KEY: z.string().min(1),
  FIREBASE_HASH_SALT_SEPARATOR: z.string(),
  FIREBASE_HASH_ROUNDS: z.string().regex(/^\d+$/),
  FIREBASE_HASH_MEM_COST: z.string().regex(/^\d+$/),
}

const emulator = common.extend({
  FIREBASE_HASH_SIGNER_KEY: legacyHash.FIREBASE_HASH_SIGNER_KEY.optional(),
  FIREBASE_HASH_SALT_SEPARATOR: legacyHash.FIREBASE_HASH_SALT_SEPARATOR.optional(),
  FIREBASE_HASH_ROUNDS: legacyHash.FIREBASE_HASH_ROUNDS.optional(),
  FIREBASE_HASH_MEM_COST: legacyHash.FIREBASE_HASH_MEM_COST.optional(),
  FIRESTORE_EMULATOR_HOST: z.string().min(1),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().min(1),
})

const production = common.extend({
  APP_ORIGINS: productionOrigins,
  /** Service account JSON, base64-encoded (Firebase Console → Project settings → Service accounts). */
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.url().refine((v) => v.startsWith('https://'), { message: 'must be an https URL' }),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  /** Resend API key (resend.com → API Keys) and a sender on a verified domain. */
  RESEND_API_KEY: z.string().min(1),
  MAIL_FROM: z.string().min(3),
  ...legacyHash,
})

export type EmulatorEnv = z.infer<typeof emulator> & { mode: 'emulator' }
export type ProductionEnv = z.infer<typeof production> & { mode: 'production' }
export type ServerEnv = EmulatorEnv | ProductionEnv

export class EnvError extends Error {
  constructor(problems: string[]) {
    // Only variable NAMES are reported — never their values.
    super(`Invalid server environment:\n  - ${problems.join('\n  - ')}`)
    this.name = 'EnvError'
  }
}

function describe(issues: z.core.$ZodIssue[]): string[] {
  return issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
}

/** Pure parser — exported for tests. */
export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const usesEmulator = Boolean(source.FIRESTORE_EMULATOR_HOST || source.FIREBASE_AUTH_EMULATOR_HOST)

  // Emulator mode disables real credentials and uses a per-instance limiter, so it must never be
  // reachable on a deployed (preview or production) Vercel environment.
  const deployed = source.VERCEL_ENV === 'production' || source.VERCEL_ENV === 'preview' || source.NODE_ENV === 'production'
  if (usesEmulator && deployed) {
    throw new EnvError(['emulator variables must never be set in a deployed or production environment'])
  }

  const schema = usesEmulator ? emulator : production
  const result = schema.safeParse(source)
  if (!result.success) throw new EnvError(describe(result.error.issues))
  return { ...result.data, mode: usesEmulator ? 'emulator' : 'production' } as ServerEnv
}

let cached: ServerEnv | undefined

export function getEnv(): ServerEnv {
  cached ??= parseEnv(process.env)
  return cached
}

/** Test helper: forget the cached env after changing process.env. */
export function resetEnvForTests(): void {
  cached = undefined
}
