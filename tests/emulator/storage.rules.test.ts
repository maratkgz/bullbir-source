// Cloud Storage rules (storage.rules) against the Storage emulator. Project "demo-bullbir" only.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage'
import { readFile } from 'node:fs/promises'

const projectId = 'demo-bullbir'
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST
const storageDescribe = storageHost ? describe : describe.skip
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
    env = await initializeTestEnvironment({
      projectId,
      storage: { host, port, rules: await readFile('storage.rules', 'utf8') },
    })
  })

  beforeEach(async () => env.clearStorage())
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

  it.each(['avatars/alice/extra.png', 'uploads/alice/a.png', 'alice.png', 'users/alice/avatar.png'])(
    'denies reads and writes on other path %s',
    async (path) => {
      const r = ref(storageOf('alice'), path)
      await assertFails(uploadBytes(r, PNG, png))
      await assertFails(getBytes(r))
    },
  )
})
