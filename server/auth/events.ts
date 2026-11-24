// Security event journal: what happened to an account, when, from which (coarse) device/network.
//   security_events/{auto} → { uid?, type, ipPrefix, device, at, meta, expiresAt (TTL) }
// Never a secret: no e-mail, no token, no code, no full IP, no User-Agent. `meta` is a small
// allow-list of typed fields, never free-form. Writing an event must NEVER fail the auth flow:
// errors are logged and swallowed.
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import { adminDb } from '../firebaseAdmin.js'
import { log, redact } from '../log.js'
import { deviceLabel } from './device.js'
import { DAY_MS, now, toIso } from './time.js'

export const SECURITY_EVENTS = 'security_events'
export const EVENT_RETENTION_MS = 180 * DAY_MS
export const EVENTS_PAGE_SIZE = 50

export const EVENT_TYPES = [
  'register',
  'email_verified',
  'login_success',
  'login_failure',
  'login_locked',
  'logout',
  'logout_all',
  'session_revoked',
  'password_changed',
  'password_reset',
  'email_changed',
  'oauth_linked',
  'account_deleted',
  'breached_password_rejected',
  'hibp_unavailable',
] as const

export type SecurityEventType = (typeof EVENT_TYPES)[number]

/** The only keys `meta` may carry. Each value is a closed enum, a bounded number or a boolean. */
const META_FIELDS = {
  method: z.enum(['password', 'code', 'oauth']),
  provider: z.enum(['google', 'apple']),
  reason: z.enum(['wrong_credentials', 'unknown_account', 'locked', 'unverified', 'user', 'security']),
  count: z.number().int().min(0).max(10_000),
  retryAfterSec: z.number().int().min(0).max(7 * 24 * 3600),
  wasCurrent: z.boolean(),
} as const

type MetaFields = typeof META_FIELDS
export type EventMeta = { [K in keyof MetaFields]?: z.infer<MetaFields[K]> }

function isMetaKey(key: string): key is keyof MetaFields {
  return Object.prototype.hasOwnProperty.call(META_FIELDS, key)
}

export type SecurityEventDoc = {
  uid?: string
  type: SecurityEventType
  ipPrefix: string
  device: string
  at: Date
  expiresAt: Date
  meta: EventMeta
}

export type EventInput = {
  uid?: string | undefined
  type: SecurityEventType
  /** Typed loosely on purpose: anything not on the allow-list is dropped at runtime. */
  meta?: Record<string, unknown> | undefined
}

export type EventContext = { req: IncomingMessage; ipPrefix: string }

/**
 * Keeps only allow-listed keys whose values pass their schema, then runs them through `redact`.
 * Returns the names of dropped keys (never their values) for a warning.
 */
export function sanitizeMeta(meta: unknown): { meta: EventMeta; dropped: string[] } {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { meta: {}, dropped: [] }
  const kept: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(meta)) {
    const parsed = isMetaKey(key) ? META_FIELDS[key].safeParse(value) : undefined
    if (parsed?.success) kept[key] = parsed.data
    else dropped.push(key.slice(0, 40))
  }
  return { meta: redact(kept) as EventMeta, dropped }
}

const uidSchema = z.string().min(1).max(128)
const typeSchema = z.enum(EVENT_TYPES)

export type EventSink = (doc: SecurityEventDoc) => Promise<void>

const firestoreSink: EventSink = async (doc) => {
  await adminDb().collection(SECURITY_EVENTS).add(doc)
}

let sink: EventSink = firestoreSink

/** Test helper: replace the Firestore writer. Pass undefined to restore. */
export function setEventSinkForTests(next: EventSink | undefined): void {
  sink = next ?? firestoreSink
}

function buildDoc(ctx: EventContext, input: EventInput): SecurityEventDoc | null {
  const type = typeSchema.safeParse(input.type)
  if (!type.success) {
    log.error('security event: unknown type')
    return null
  }
  const { meta, dropped } = sanitizeMeta(input.meta)
  if (dropped.length) log.warn('security event: meta keys dropped', { eventType: type.data, dropped })
  const at = now()
  const uid = uidSchema.safeParse(input.uid)
  return {
    ...(uid.success ? { uid: uid.data } : {}),
    type: type.data,
    ipPrefix: String(ctx.ipPrefix ?? '').slice(0, 64),
    device: deviceLabel(ctx.req),
    at: new Date(at),
    expiresAt: new Date(at + EVENT_RETENTION_MS),
    meta,
  }
}

/**
 * Records one event. Never throws and never rejects: the journal failing must not fail auth.
 * Await it (serverless may freeze the instance after the response).
 */
export async function recordEvent(ctx: EventContext, input: EventInput): Promise<void> {
  try {
    const doc = buildDoc(ctx, input)
    if (doc) await sink(doc)
  } catch (err) {
    log.error('security event write failed', { eventType: String(input?.type).slice(0, 40), err })
  }
}

export type PublicSecurityEvent = { type: SecurityEventType; at: string | null; device: string; ipPrefix: string }

/**
 * The user's latest events, newest first. Needs the composite index
 * security_events (uid ASC, at DESC).
 */
export async function listSecurityEvents(uid: string, limit = EVENTS_PAGE_SIZE): Promise<PublicSecurityEvent[]> {
  const snap = await adminDb().collection(SECURITY_EVENTS)
    .where('uid', '==', uid).orderBy('at', 'desc').limit(limit).get()
  return snap.docs.map((d) => ({
    type: d.get('type') as SecurityEventType,
    at: toIso(d.get('at')),
    device: String(d.get('device') ?? ''),
    ipPrefix: String(d.get('ipPrefix') ?? ''),
  }))
}
