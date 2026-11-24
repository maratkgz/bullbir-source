// Server-side sessions. The browser holds a random 32-byte token in an HttpOnly cookie; the
// database holds only its SHA-256, so a database leak does not let anyone log in.
//   sessions/{sha256(token)} → { uid, publicId, createdAt, lastSeenAt, idleExpiresAt,
//                                absoluteExpiresAt, expiresAt (TTL), device, ipPrefix }
// Lifetime: 7 days without activity, 30 days at most.
import type { IncomingMessage } from 'node:http'
import { adminAuth, adminDb } from '../firebaseAdmin.js'
import { AppError } from '../errors.js'
import { readSessionToken, sessionCookie } from './cookies.js'
import { randomId, randomToken, sha256Hex } from './crypto.js'
import { deviceLabel } from './device.js'
import { DAY_MS, MINUTE_MS, now, toIso, toMs } from './time.js'

export const SESSIONS = 'sessions'
export const IDLE_MS = 7 * DAY_MS
export const ABSOLUTE_MS = 30 * DAY_MS
/** Don't write on every request — refresh activity at most this often. */
const TOUCH_EVERY_MS = 15 * MINUTE_MS

export type Session = { id: string; uid: string; publicId: string; createdAt: number }

export type SessionInfo = {
  id: string
  current: boolean
  device: string
  ipPrefix: string
  createdAt: string | null
  lastSeenAt: string | null
}

/** Creates a session and returns the Set-Cookie value. Always a brand-new token (rotation). */
export async function createSession(uid: string, req: IncomingMessage, ipPrefix: string): Promise<string> {
  const token = randomToken()
  const t = now()
  const idle = t + IDLE_MS
  const absolute = t + ABSOLUTE_MS
  await adminDb().collection(SESSIONS).doc(sha256Hex(token)).create({
    uid,
    publicId: randomId(),
    createdAt: new Date(t),
    lastSeenAt: new Date(t),
    idleExpiresAt: new Date(idle),
    absoluteExpiresAt: new Date(absolute),
    expiresAt: new Date(Math.min(idle, absolute)),
    device: deviceLabel(req),
    ipPrefix,
  })
  // The browser may keep it up to the absolute limit; the server enforces the idle timeout.
  return sessionCookie(token, Math.floor(ABSOLUTE_MS / 1000))
}

/** The current session, or null if missing/expired (expired ones are deleted). */
export async function findSession(req: IncomingMessage): Promise<Session | null> {
  const token = readSessionToken(req)
  if (!token) return null
  const ref = adminDb().collection(SESSIONS).doc(sha256Hex(token))
  const snap = await ref.get()
  if (!snap.exists) return null

  const t = now()
  const idle = toMs(snap.get('idleExpiresAt')) ?? 0
  const absolute = toMs(snap.get('absoluteExpiresAt')) ?? 0
  if (t >= idle || t >= absolute) {
    await ref.delete()
    return null
  }
  const lastSeen = toMs(snap.get('lastSeenAt')) ?? 0
  if (t - lastSeen >= TOUCH_EVERY_MS) {
    const nextIdle = t + IDLE_MS
    await ref.update({
      lastSeenAt: new Date(t),
      idleExpiresAt: new Date(nextIdle),
      expiresAt: new Date(Math.min(nextIdle, absolute)),
    })
  }
  return {
    id: ref.id,
    uid: String(snap.get('uid')),
    publicId: String(snap.get('publicId')),
    createdAt: toMs(snap.get('createdAt')) ?? 0,
  }
}

export async function requireSession(req: IncomingMessage): Promise<Session> {
  const session = await findSession(req)
  if (!session) throw new AppError('unauthorized', 'Not signed in')
  return session
}

/**
 * Revokes the user's Firebase refresh tokens. A bridge sign-in on a stolen device would otherwise
 * keep Firestore access after its session is gone. Other devices re-bridge with their own valid
 * session. ID tokens already issued stay valid for at most 1 hour.
 */
export async function revokeFirebaseTokens(uid: string): Promise<void> {
  try {
    await adminAuth().revokeRefreshTokens(uid)
  } catch (err) {
    // The Firebase user record appears on first bridge sign-in; before that there is nothing to revoke.
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err
  }
}

/** Ends the session behind the request's cookie (if any). Returns its uid. */
export async function deleteSessionByToken(req: IncomingMessage): Promise<string | null> {
  const token = readSessionToken(req)
  if (!token) return null
  const ref = adminDb().collection(SESSIONS).doc(sha256Hex(token))
  const snap = await ref.get()
  if (!snap.exists) return null
  await ref.delete()
  return String(snap.get('uid'))
}

export async function listSessions(uid: string, currentId: string): Promise<SessionInfo[]> {
  const snap = await adminDb().collection(SESSIONS).where('uid', '==', uid).get()
  const t = now()
  return snap.docs
    .filter((d) => (toMs(d.get('idleExpiresAt')) ?? 0) > t && (toMs(d.get('absoluteExpiresAt')) ?? 0) > t)
    .map((d) => ({
      id: String(d.get('publicId')),
      current: d.id === currentId,
      device: String(d.get('device') ?? ''),
      ipPrefix: String(d.get('ipPrefix') ?? ''),
      createdAt: toIso(d.get('createdAt')),
      lastSeenAt: toIso(d.get('lastSeenAt')),
    }))
    .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))
}

/** Revokes one of the user's own sessions by its public id. Returns whether it was the current one. */
export async function revokeSession(uid: string, publicId: string, currentId: string): Promise<boolean> {
  const snap = await adminDb().collection(SESSIONS)
    .where('uid', '==', uid).where('publicId', '==', publicId).limit(1).get()
  const doc = snap.docs[0]
  if (!doc) throw new AppError('not_found', 'Session not found')
  await doc.ref.delete()
  await revokeFirebaseTokens(uid)
  return doc.id === currentId
}

/**
 * Signs the user out everywhere: deletes every session and revokes Firebase refresh tokens, so
 * an already-open tab on another device loses its Firestore access when its ID token expires.
 */
export async function revokeAllSessions(uid: string): Promise<void> {
  const db = adminDb()
  const snap = await db.collection(SESSIONS).where('uid', '==', uid).get()
  const writer = db.bulkWriter()
  for (const d of snap.docs) void writer.delete(d.ref)
  await writer.close()
  await revokeFirebaseTokens(uid)
}
