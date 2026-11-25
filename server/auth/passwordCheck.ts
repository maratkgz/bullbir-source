// Password check for login, including the lazy migration of accounts imported from Firebase Auth
// (stage 3): an imported account carries Firebase's scrypt hash; the first correct login re-hashes
// the password with argon2id and deletes the old hash. No mass password reset needed.
import { getEnv } from '../env.js'
import { log } from '../log.js'
import { parseLegacyHashParams, verifyFirebaseScrypt, type LegacyHashParams } from './legacyHash.js'
import { hashPassword, verifyPasswordOrDummy } from './password.js'
import { completeLegacyMigration, type AuthUser } from './users.js'

let cachedParams: LegacyHashParams | null | undefined

function legacyParams(): LegacyHashParams | null {
  if (cachedParams !== undefined) return cachedParams
  try {
    cachedParams = parseLegacyHashParams(getEnv() as unknown as Record<string, string | undefined>)
  } catch (err) {
    // Missing in the emulator is fine; in production env.ts already refuses to start without them.
    log.error('legacy password parameters unavailable', { err })
    cachedParams = null
  }
  return cachedParams
}

export function resetLegacyParamsForTests(): void {
  cachedParams = undefined
}

// scrypt (N=2^14, r=8) takes ~16 MB and the libuv thread pool; cap parallel legacy checks so a
// flood of logins for imported accounts cannot starve everything else.
const MAX_PARALLEL_LEGACY = 2
let running = 0
const waiting: Array<() => void> = []

async function withLegacySlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL_LEGACY) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/**
 * True if `password` is the user's password. Every path costs at least one argon2 verification,
 * and login responses are additionally padded (routes/auth.ts), so timing does not reveal whether
 * an address is unknown, migrated or still legacy.
 */
export async function checkLoginPassword(user: AuthUser | null, password: string): Promise<boolean> {
  const legacy = user && !user.passwordHash && user.legacyPassword && user.status === 'active'
    ? user.legacyPassword
    : null
  if (!user || !legacy) return verifyPasswordOrDummy(user?.passwordHash, password)
  const params = legacyParams()
  if (!params) return verifyPasswordOrDummy(null, password)
  const [ok] = await Promise.all([
    withLegacySlot(() => verifyFirebaseScrypt(password, legacy, params)),
    verifyPasswordOrDummy(null, password),
  ])
  if (ok) await completeLegacyMigration(user.uid, await hashPassword(password))
  return ok
}
