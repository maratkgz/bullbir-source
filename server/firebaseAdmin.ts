// Firebase Admin SDK — the server's privileged access to Auth (custom tokens for the Firestore
// bridge) and to the server-only auth collections. In emulator mode no credentials are needed:
// the SDK reads FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST itself.
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { z } from 'zod'
import { EnvError, getEnv } from './env.js'

const APP_NAME = 'bullbir-server'

const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
})

function decodeServiceAccount(base64: string): ServiceAccount {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  } catch {
    throw new EnvError(['FIREBASE_SERVICE_ACCOUNT_BASE64: not base64-encoded JSON'])
  }
  const result = serviceAccountSchema.safeParse(parsed)
  // Report field names only — the key material must never reach a log.
  if (!result.success) throw new EnvError(['FIREBASE_SERVICE_ACCOUNT_BASE64: missing project_id, client_email or private_key'])
  return { projectId: result.data.project_id, clientEmail: result.data.client_email, privateKey: result.data.private_key }
}

function app(): App {
  const existing = getApps().find((a) => a.name === APP_NAME)
  if (existing) return existing
  const env = getEnv()
  if (env.mode === 'emulator') {
    return initializeApp({ projectId: env.FIREBASE_PROJECT_ID }, APP_NAME)
  }
  return initializeApp(
    { credential: cert(decodeServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_BASE64)), projectId: env.FIREBASE_PROJECT_ID },
    APP_NAME,
  )
}

/**
 * The Storage bucket, if configured (FIREBASE_STORAGE_BUCKET; in the emulator it defaults to
 * `<project>.appspot.com`, matching the client's fallback config). Null when unknown.
 */
export function adminBucket(): ReturnType<ReturnType<typeof getStorage>['bucket']> | null {
  const env = getEnv()
  const name = env.FIREBASE_STORAGE_BUCKET || (env.mode === 'emulator' ? `${env.FIREBASE_PROJECT_ID}.appspot.com` : '')
  return name ? getStorage(app()).bucket(name) : null
}

export function adminAuth(): Auth {
  return getAuth(app())
}

export function adminDb(): Firestore {
  return getFirestore(app())
}
