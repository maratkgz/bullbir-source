// Auth bridge (ADR 001): the server mints a Firebase custom token for an existing uid, and the
// client SDK exchanges it for a Firebase session with the SAME uid and the server-set claims.
// Runs only against the Auth/Firestore emulators (project "demo-bullbir").
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, inMemoryPersistence, initializeAuth, signInWithCustomToken, signOut, type Auth } from 'firebase/auth'
import { deleteApp as deleteAdminApp, getApps as getAdminApps } from 'firebase-admin/app'
import { resetEnvForTests } from '../../server/env.js'
import { adminAuth } from '../../server/firebaseAdmin.js'

const projectId = 'demo-bullbir'
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
const bridgeDescribe = authHost && firestoreHost ? describe : describe.skip

bridgeDescribe('Auth bridge (custom token → Firebase session)', () => {
  const uid = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let clientApp: FirebaseApp
  let clientAuth: Auth

  beforeAll(() => {
    process.env.FIREBASE_PROJECT_ID = projectId
    process.env.APP_ORIGINS = 'http://localhost:5173'
    process.env.AUTH_PEPPER = Buffer.alloc(32, 3).toString('base64')
    resetEnvForTests()

    clientApp = initializeApp({ projectId, apiKey: 'fake-api-key' }, `bridge-test-${uid}`)
    clientAuth = initializeAuth(clientApp, { persistence: inMemoryPersistence })
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true })
  })

  afterAll(async () => {
    await signOut(clientAuth).catch(() => undefined)
    await adminAuth().deleteUser(uid).catch(() => undefined)
    if (clientApp) await deleteApp(clientApp)
    await Promise.all(getAdminApps().map((a) => deleteAdminApp(a)))
    resetEnvForTests()
  })

  it('signs the client in as the same uid with the bb_ev claim', async () => {
    await adminAuth().createUser({ uid, email: `${uid}@example.test` })
    const token = await adminAuth().createCustomToken(uid, { bb_ev: true })

    const cred = await signInWithCustomToken(clientAuth, token)
    expect(cred.user.uid).toBe(uid)

    const idToken = await cred.user.getIdTokenResult()
    expect(idToken.claims.bb_ev).toBe(true)
    expect(idToken.claims.sub).toBe(uid)
  })

  it('the verified ID token carries the claim on the server side too', async () => {
    const user = clientAuth.currentUser
    expect(user?.uid).toBe(uid)
    const decoded = await adminAuth().verifyIdToken(await user!.getIdToken())
    expect(decoded.uid).toBe(uid)
    expect(decoded.bb_ev).toBe(true)
  })

  it('revokeRefreshTokens succeeds and is recorded on the user', async () => {
    await expect(adminAuth().revokeRefreshTokens(uid)).resolves.toBeUndefined()
    const record = await adminAuth().getUser(uid)
    expect(record.tokensValidAfterTime).toBeTruthy()
  })
})
