import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
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
  ])('denies client access to server-only document %s', async (path) => {
    const db = verified('alice')
    await assertFails(getDoc(doc(db, path)))
    await assertFails(setDoc(doc(db, path), { value: 'must not persist' }))
  })

  it('keeps admin records read-only to clients', async () => {
    const db = verified('alice')
    await assertFails(setDoc(doc(db, 'admins/alice'), { role: 'admin' }))
    await assertFails(getDoc(doc(db, 'admins/bob')))
  })
})
