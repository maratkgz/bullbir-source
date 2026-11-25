// Cloud Storage rules (storage.rules) against the Storage emulator. Project "demo-bullbir" only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage'
import { doc, setDoc } from 'firebase/firestore'
import { readFile } from 'node:fs/promises'

const projectId = 'demo-bullbir'
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST
const storageDescribe = storageHost && firestoreHost ? describe : describe.skip
let env: RulesTestEnvironment

// Smallest valid PNG header + a few bytes is enough: rules look at size and contentType only.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const png = { contentType: 'image/png' }
const TWO_MB = 2 * 1024 * 1024

storageDescribe('Storage security rules', () => {
  beforeAll(async () => {
    if (!storageHost) throw new Error('Run storage rules tests through the Storage emulator')
    const [host, portText] = storageHost.replace(/^https?:\/\//, '').split(':')
    const port = Number(portText)
    if (!host || !Number.isInteger(port)) throw new Error('Invalid FIREBASE_STORAGE_EMULATOR_HOST')
    // Firestore too: the avatar rules read auth_state/{uid} cross-service.
    const [fsHost, fsPortText] = String(firestoreHost).split(':')
    if (!fsHost || !Number.isInteger(Number(fsPortText))) throw new Error('Invalid FIRESTORE_EMULATOR_HOST')
    env = await initializeTestEnvironment({
      projectId,
      storage: { host, port, rules: await readFile('storage.rules', 'utf8') },
      firestore: { host: fsHost, port: Number(fsPortText), rules: await readFile('firestore.rules', 'utf8') },
    })
  })

  beforeEach(async () => {
    await env.clearStorage()
    await env.clearFirestore()
  })
  afterAll(async () => env?.cleanup())

  // `bb_ev` = verified email, set by our server's custom token (the only Firebase session source).
  const storageOf = (uid: string) => env.authenticatedContext(uid, { bb_ev: true }).storage()
  const anonymous = () => env.unauthenticatedContext().storage()

  it.each([
    ['no claim', {}],
    ['bb_ev false', { bb_ev: false }],
    ['Firebase email_verified only', { email_verified: true }],
  ])('denies avatar upload for an unverified owner (%s)', async (_label, claims) => {
    const db = env.authenticatedContext('alice', claims).storage()
    await assertFails(uploadBytes(ref(db, 'avatars/alice'), PNG, png))
  })

  it('still lets an unverified owner delete their avatar (account deletion)', async () => {
    await assertSucceeds(uploadBytes(ref(storageOf('alice'), 'avatars/alice'), PNG, png))
    const asUnverified = ref(env.authenticatedContext('alice', { bb_ev: false }).storage(), 'avatars/alice')
    await assertSucceeds(deleteObject(asUnverified))
  })

  it('lets the owner upload, read and delete a small PNG avatar', async () => {
    const avatar = ref(storageOf('alice'), 'avatars/alice')
    await assertSucceeds(uploadBytes(avatar, PNG, png))
    const bytes = await assertSucceeds(getBytes(avatar))
    expect(bytes.byteLength).toBe(PNG.byteLength)
    await assertSucceeds(deleteObject(avatar))
  })

  it.each(['image/jpeg', 'image/webp', 'image/gif'])('accepts %s avatars', async (contentType) => {
    await assertSucceeds(uploadBytes(ref(storageOf('alice'), 'avatars/alice'), PNG, { contentType }))
  })

  it('denies other users reading, overwriting or deleting the avatar', async () => {
    await assertSucceeds(uploadBytes(ref(storageOf('alice'), 'avatars/alice'), PNG, png))
    const asBob = ref(storageOf('bob'), 'avatars/alice')
    await assertFails(getBytes(asBob))
    await assertFails(uploadBytes(asBob, PNG, png))
    await assertFails(deleteObject(asBob))
  })

  it('denies unauthenticated access', async () => {
    await assertSucceeds(uploadBytes(ref(storageOf('alice'), 'avatars/alice'), PNG, png))
    await assertFails(getBytes(ref(anonymous(), 'avatars/alice')))
    await assertFails(uploadBytes(ref(anonymous(), 'avatars/alice'), PNG, png))
  })

  it('rejects avatars of 2 MB or more', async () => {
    const big = new Uint8Array(TWO_MB)
    await assertFails(uploadBytes(ref(storageOf('alice'), 'avatars/alice'), big, png))
  })

  it('accepts an avatar just under 2 MB', async () => {
    const almost = new Uint8Array(TWO_MB - 1)
    await assertSucceeds(uploadBytes(ref(storageOf('alice'), 'avatars/alice'), almost, png))
  })

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream', 'application/javascript', 'image/pngx'])(
    'rejects content type %s',
    async (contentType) => {
      await assertFails(uploadBytes(ref(storageOf('alice'), 'avatars/alice'), PNG, { contentType }))
    },
  )

  // Credential version (cross-service read of auth_state/{uid} from Firestore).
  describe('credential version (auth_state cv vs bb_cv)', () => {
    const CV = 1000
    const avatarAs = (uid: string, bbCv?: number) =>
      ref(env.authenticatedContext(uid, bbCv === undefined ? { bb_ev: true } : { bb_ev: true, bb_cv: bbCv }).storage(), `avatars/${uid}`)

    async function seedAvatar(cv: number | null): Promise<void> {
      await assertSucceeds(uploadBytes(avatarAs('alice'), PNG, png)) // before any cv exists
      if (cv !== null) {
        await env.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), 'auth_state/alice'), { cv })
        })
      }
    }

    it('no auth_state doc → allowed as before', async () => {
      await seedAvatar(null)
      await assertSucceeds(getBytes(avatarAs('alice', 0)))
      await assertSucceeds(uploadBytes(avatarAs('alice', 0), PNG, png))
      await assertSucceeds(deleteObject(avatarAs('alice', 0)))
    })

    it.each([
      ['bb_cv 999', 999],
      ['no bb_cv claim', undefined],
    ])('stale token (%s) cannot read, overwrite or delete the avatar', async (_label, bbCv) => {
      await seedAvatar(CV)
      await assertFails(getBytes(avatarAs('alice', bbCv)))
      await assertFails(uploadBytes(avatarAs('alice', bbCv), PNG, png))
      await assertFails(deleteObject(avatarAs('alice', bbCv)))
    })

    it('current token (bb_cv == cv) can read, overwrite and delete', async () => {
      await seedAvatar(CV)
      await assertSucceeds(getBytes(avatarAs('alice', CV)))
      await assertSucceeds(uploadBytes(avatarAs('alice', CV), PNG, png))
      await assertSucceeds(deleteObject(avatarAs('alice', CV)))
    })

    it('another user’s cv does not matter', async () => {
      await seedAvatar(CV)
      await assertSucceeds(uploadBytes(avatarAs('bob', 0), PNG, png))
    })
  })

  it.each(['avatars/alice/extra.png', 'uploads/alice/a.png', 'alice.png', 'users/alice/avatar.png'])(
    'denies reads and writes on other path %s',
    async (path) => {
      const r = ref(storageOf('alice'), path)
      await assertFails(uploadBytes(r, PNG, png))
      await assertFails(getBytes(r))
    },
  )
})
