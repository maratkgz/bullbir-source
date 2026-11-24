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

/** True if `password` is the user's password. Burns comparable CPU when there is no user. */
export async function checkLoginPassword(user: AuthUser | null, password: string): Promise<boolean> {
  if (!user || user.passwordHash || !user.legacyPassword) {
    return verifyPasswordOrDummy(user?.passwordHash, password)
  }
  const params = legacyParams()
  if (!params) return verifyPasswordOrDummy(null, password)
  const ok = await verifyFirebaseScrypt(password, user.legacyPassword, params)
  if (ok) await completeLegacyMigration(user.uid, await hashPassword(password))
  return ok
}
