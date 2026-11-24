// Which BullBir account an OAuth identity signs in to.
//   auth_accounts/{providerId}:{sub} → { uid, provider, email, linkedAt }   (Admin SDK only)
// Rules (threat matrix, docs/auth-migration-plan.md — "account takeover via Google"):
//   1. a link for this sub exists                    → sign in to that account
//   2. no link, an account with this email exists    → link ONLY if the provider AND we have
//                                                       verified the address; otherwise refuse
//   3. no account at all                              → create one (verified, no password) + link
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '../../firebaseAdmin.js'
import { log } from '../../log.js'
import { newUid } from '../crypto.js'
import { emailKey } from '../email.js'
import { now } from '../time.js'
import { EMAILS, USERS } from '../users.js'
import { OAuthError, type OAuthIdentity } from './provider.js'

export const ACCOUNTS = 'auth_accounts'

export type LinkDecision =
  | { action: 'sign_in'; uid: string }
  | { action: 'link'; uid: string }
  | { action: 'create' }
  | { action: 'refuse'; reason: 'link_unverified' }

export type LinkInput = {
  linkedUid: string | null
  existingUser: { uid: string; emailVerified: boolean } | null
  identity: Pick<OAuthIdentity, 'emailVerified'>
}

/** Pure decision — the security rule lives here and is unit-tested. */
export function decideLink({ linkedUid, existingUser, identity }: LinkInput): LinkDecision {
  if (linkedUid) return { action: 'sign_in', uid: linkedUid }
  if (existingUser) {
    return identity.emailVerified && existingUser.emailVerified
      ? { action: 'link', uid: existingUser.uid }
      : { action: 'refuse', reason: 'link_unverified' }
  }
  return { action: 'create' }
}

/** Document id. `/` would create a sub-path, so it is refused (Google subs are digits). */
export function accountId(providerId: string, sub: string): string {
  if (!sub || sub.includes('/') || providerId.includes('/')) throw new OAuthError('invalid_token', 'Unusable subject')
  return `${providerId}:${sub}`
}

/** Address still only in Firebase Auth (not yet imported, stage 3)? Then don't create a twin. */
async function existsInLegacyAuth(email: string): Promise<boolean> {
  try {
    await adminAuth().getUserByEmail(email)
    return true
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') return false
    log.error('legacy account lookup failed', { err })
    throw err
  }
}

export type ResolvedAccount = { uid: string; created: boolean; linked: boolean }

export async function resolveOAuthAccount(identity: OAuthIdentity): Promise<ResolvedAccount> {
  const db = adminDb()
  const linkRef = db.collection(ACCOUNTS).doc(accountId(identity.providerId, identity.sub))
  const indexRef = db.collection(EMAILS).doc(emailKey(identity.email))

  const [link0, index0] = await Promise.all([linkRef.get(), indexRef.get()])
  if (!link0.exists && !index0.exists && (await existsInLegacyAuth(identity.email))) {
    throw new OAuthError('account_exists', 'Account not migrated yet')
  }

  return db.runTransaction(async (tx) => {
    const link = await tx.get(linkRef)
    const index = await tx.get(indexRef)
    const linked: unknown = link.get('uid')
    const indexUid: unknown = index.get('uid')

    let existingUser: LinkInput['existingUser'] = null
    if (typeof linked !== 'string' && typeof indexUid === 'string') {
      const user = await tx.get(db.collection(USERS).doc(indexUid))
      if (user.exists) existingUser = { uid: indexUid, emailVerified: user.get('emailVerified') === true }
    }

    const decision = decideLink({ linkedUid: typeof linked === 'string' ? linked : null, existingUser, identity })
    const ts = new Date(now())
    const linkDoc = { provider: identity.providerId, email: identity.email, linkedAt: ts }

    switch (decision.action) {
      case 'sign_in':
        return { uid: decision.uid, created: false, linked: false }
      case 'refuse':
        throw new OAuthError(decision.reason, 'Email not verified on both sides')
      case 'link':
        tx.create(linkRef, { uid: decision.uid, ...linkDoc })
        tx.update(db.collection(USERS).doc(decision.uid), {
          providers: FieldValue.arrayUnion(identity.providerId),
          updatedAt: ts,
        })
        return { uid: decision.uid, created: false, linked: true }
      case 'create': {
        // An index pointing at a missing user is corrupt data: tx.create fails → generic error.
        const uid = newUid()
        tx.create(indexRef, { uid, createdAt: ts })
        tx.create(db.collection(USERS).doc(uid), {
          email: identity.email,
          emailVerified: true,
          passwordHash: null,
          displayName: identity.name,
          providers: [identity.providerId],
          status: 'active',
          createdAt: ts,
          updatedAt: ts,
          lastLoginAt: null,
          passwordChangedAt: null,
        })
        tx.create(linkRef, { uid, ...linkDoc })
        return { uid, created: true, linked: true }
      }
    }
  })
}
