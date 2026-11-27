import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { readFile } from 'node:fs/promises'

const projectId = 'demo-bullbir'
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
const rulesDescribe = emulatorHost ? describe : describe.skip
let env: RulesTestEnvironment

rulesDescribe('Firestore security rules', () => {
  beforeAll(async () => {
    if (!emulatorHost) throw new Error('Run rules tests through the Firestore emulator')
    const [host, portText] = emulatorHost.split(':')
    const port = Number(portText)
    if (!host || !Number.isInteger(port)) throw new Error('Invalid FIRESTORE_EMULATOR_HOST')
    env = await initializeTestEnvironment({
      projectId,
      firestore: {
        host,
        port,
        rules: await readFile('firestore.rules', 'utf8'),
      },
    })
  })

  beforeEach(async () => env.clearFirestore())
  afterAll(async () => env?.cleanup())

  // Only our server's custom tokens create Firebase sessions; `bb_ev` carries email verification.
  const verified = (uid: string) => env.authenticatedContext(uid, { bb_ev: true }).firestore()
  const unverified = (uid: string) => env.authenticatedContext(uid, { bb_ev: false }).firestore()
  const firebaseVerifiedOnly = (uid: string) =>
    env.authenticatedContext(uid, { email_verified: true }).firestore()

  it('allows a verified owner to create and update ordinary profile fields', async () => {
    const ref = doc(verified('alice'), 'users/alice')
    await assertSucceeds(setDoc(ref, { email: 'alice@example.test', displayName: 'Alice', onboardingDone: false }))
    await assertSucceeds(updateDoc(ref, { displayName: 'Alice B', bio: 'Hello' }))
  })

  it('stores a compressed avatar and banner in the profile, within size caps', async () => {
    const ref = doc(verified('alice'), 'users/alice')
    await assertSucceeds(setDoc(ref, { email: 'alice@example.test', onboardingDone: true }))
    const jpeg = (bytes: number) => `data:image/jpeg;base64,${'A'.repeat(bytes)}`
    await assertSucceeds(updateDoc(ref, { photoURL: jpeg(50_000) }))
    await assertSucceeds(updateDoc(ref, { bannerURL: jpeg(300_000) }))
    await assertSucceeds(updateDoc(ref, { photoURL: 'https://lh3.googleusercontent.com/a/photo' }))
    await assertSucceeds(updateDoc(ref, { bannerURL: null }))
    await assertFails(updateDoc(ref, { photoURL: jpeg(250_000) }))
    await assertFails(updateDoc(ref, { bannerURL: jpeg(500_000) }))
    await assertFails(updateDoc(ref, { photoURL: 'javascript:alert(1)' }))
    await assertFails(updateDoc(ref, { bannerURL: 'data:text/html;base64,PHNjcmlwdD4=' }))
    await assertFails(updateDoc(ref, { photoURL: 42 }))
  })

  it('rejects client-created privilege fields in the root profile', async () => {
    await assertFails(setDoc(doc(verified('alice'), 'users/alice'), { email: 'alice@example.test', role: 'admin' }))
    await assertFails(setDoc(doc(verified('alice'), 'users/alice'), { email: 'alice@example.test', plan: 'enterprise' }))
  })

  it('prevents changing identity and creation metadata from the client', async () => {
    const db = verified('alice')
    const ref = doc(db, 'users/alice')
    await assertSucceeds(setDoc(ref, { email: 'alice@example.test', createdAt: 'initial' }))
    await assertFails(updateDoc(ref, { email: 'attacker@example.test' }))
    await assertFails(updateDoc(ref, { createdAt: 'replaced' }))
  })

  it('allows verified owners, but not other users, to access module data', async () => {
    await assertSucceeds(setDoc(doc(verified('alice'), 'users/alice/tasks/t1'), { title: 'Private task' }))
    await assertFails(getDoc(doc(verified('bob'), 'users/alice/tasks/t1')))
    await assertFails(setDoc(doc(verified('bob'), 'users/alice/tasks/t2'), { title: 'Injected' }))
  })

  it('blocks module access before email verification', async () => {
    await assertFails(setDoc(doc(unverified('alice'), 'users/alice/tasks/t1'), { title: 'Private task' }))
  })

  it('lets an unverified owner create the root profile (needed before verification)', async () => {
    await assertSucceeds(setDoc(doc(unverified('alice'), 'users/alice'), { email: 'alice@example.test', onboardingDone: false }))
  })

  it('ignores Firebase email_verified without the bb_ev claim', async () => {
    const db = firebaseVerifiedOnly('alice')
    await assertFails(setDoc(doc(db, 'users/alice/tasks/t1'), { title: 'Private task' }))
    await assertFails(getDoc(doc(db, 'users/alice/tasks/t1')))
    await assertFails(getDoc(doc(db, 'aiDomains/d1')))
  })

  it('ignores a phone-only Firebase token without the bb_ev claim', async () => {
    const db = env.authenticatedContext('alice', { phone_number: '+996700000000' }).firestore()
    await assertFails(setDoc(doc(db, 'users/alice/tasks/t1'), { title: 'Private task' }))
  })

  it.each([
    'users_auth/alice',
    'auth_emails/email-hash',
    'sessions/session-hash',
    'otp_codes/otp-id',
    'auth_accounts/provider-subject',
    'security_events/event-id',
    'auth_throttle/some-key',
    'auth_state/alice',
    'auth_state/bob',
  ])('denies client access to server-only document %s', async (path) => {
    const db = verified('alice')
    await assertFails(getDoc(doc(db, path)))
    await assertFails(setDoc(doc(db, path), { value: 'must not persist' }))
  })

  // Credential version: after a password reset/change, email change, "sign out everywhere" or
  // deletion the server bumps auth_state/{uid}.cv; bridge tokens carry it as `bb_cv`.
  describe('credential version (auth_state cv vs bb_cv)', () => {
    const CV = 1000
    const withCv = (uid: string, bbCv?: number) =>
      env.authenticatedContext(uid, bbCv === undefined ? { bb_ev: true } : { bb_ev: true, bb_cv: bbCv }).firestore()

    async function seed(cv: number | null): Promise<void> {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore()
        await setDoc(doc(db, 'users/alice'), { email: 'alice@example.test', displayName: 'Alice' })
        await setDoc(doc(db, 'users/alice/tasks/t1'), { title: 'Private task' })
        if (cv !== null) await setDoc(doc(db, 'auth_state/alice'), { cv })
      })
    }

    it('no auth_state doc → access as before (also without a bb_cv claim)', async () => {
      await seed(null)
      for (const db of [withCv('alice'), withCv('alice', 0)]) {
        await assertSucceeds(getDoc(doc(db, 'users/alice')))
        await assertSucceeds(updateDoc(doc(db, 'users/alice'), { displayName: 'Alice B' }))
        await assertSucceeds(getDoc(doc(db, 'users/alice/tasks/t1')))
        await assertSucceeds(setDoc(doc(db, 'users/alice/tasks/t2'), { title: 'New' }))
      }
    })

    it.each([
      ['bb_cv 999', 999],
      ['no bb_cv claim', undefined],
    ])('stale token (%s) is denied reads and writes on the root profile and module data', async (_label, bbCv) => {
      await seed(CV)
      const db = withCv('alice', bbCv)
      await assertFails(getDoc(doc(db, 'users/alice')))
      await assertFails(updateDoc(doc(db, 'users/alice'), { displayName: 'Hijacked' }))
      await assertFails(getDoc(doc(db, 'users/alice/tasks/t1')))
      await assertFails(setDoc(doc(db, 'users/alice/tasks/t1'), { title: 'Overwritten' }))
      await assertFails(setDoc(doc(db, 'users/alice/tasks/t2'), { title: 'Injected' }))
      await assertFails(deleteDoc(doc(db, 'users/alice/tasks/t1')))
      await assertFails(deleteDoc(doc(db, 'users/alice')))
    })

    it('stale token cannot (re)create a deleted root profile', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'auth_state/alice'), { cv: CV }) })
      await assertFails(setDoc(doc(withCv('alice', 999), 'users/alice'), { email: 'alice@example.test' }))
      await assertSucceeds(setDoc(doc(withCv('alice', CV), 'users/alice'), { email: 'alice@example.test' }))
    })

    it.each([
      ['bb_cv equal to cv', CV],
      ['bb_cv newer than cv', CV + 1],
    ])('current token (%s) is allowed', async (_label, bbCv) => {
      await seed(CV)
      const db = withCv('alice', bbCv)
      await assertSucceeds(getDoc(doc(db, 'users/alice')))
      await assertSucceeds(updateDoc(doc(db, 'users/alice'), { displayName: 'Alice B' }))
      await assertSucceeds(getDoc(doc(db, 'users/alice/tasks/t1')))
      await assertSucceeds(setDoc(doc(db, 'users/alice/tasks/t2'), { title: 'New' }))
      await assertSucceeds(deleteDoc(doc(db, 'users/alice/tasks/t1')))
    })

    it('a bumped cv of one user does not affect another user', async () => {
      await seed(CV)
      const bob = withCv('bob', 0)
      await assertSucceeds(setDoc(doc(bob, 'users/bob/tasks/t1'), { title: 'Bob task' }))
      await assertSucceeds(getDoc(doc(bob, 'users/bob/tasks/t1')))
    })

    it('the client cannot read or lower its own credential version', async () => {
      await seed(CV)
      const db = withCv('alice', CV)
      await assertFails(getDoc(doc(db, 'auth_state/alice')))
      await assertFails(setDoc(doc(db, 'auth_state/alice'), { cv: 0 }))
      await assertFails(updateDoc(doc(db, 'auth_state/alice'), { cv: 0 }))
      await assertFails(deleteDoc(doc(db, 'auth_state/alice')))
    })
  })

  it('keeps admin records read-only to clients', async () => {
    const db = verified('alice')
    await assertFails(setDoc(doc(db, 'admins/alice'), { role: 'admin' }))
    await assertFails(getDoc(doc(db, 'admins/bob')))
  })
})
