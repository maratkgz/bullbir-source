// Email + password accounts: register → verify email (code + password) → session; login; logout;
// me; the Firebase bridge token. Contract: docs/auth-api.md.
import { z } from 'zod'
import { adminAuth } from '../firebaseAdmin.js'
import { AppError } from '../errors.js'
import { LIMITS } from '../limits.js'
import { enforceLimit } from '../rateLimit.js'
import type { RequestContext, Route, RouteResult } from '../router.js'
import { parseBody } from '../validate.js'
import { clearSessionCookie } from '../auth/cookies.js'
import { credentialVersion } from '../auth/credentials.js'
import { recordEvent } from '../auth/events.js'
import { isAppError } from '../errors.js'
import { emailKey, emailSchema } from '../auth/email.js'
import { mailer } from '../auth/mailer.js'
import { consumeCode, issueCode } from '../auth/otp.js'
import { withMinDuration } from '../auth/pacing.js'
import { checkLoginPassword } from '../auth/passwordCheck.js'
import {
  assertAcceptablePassword, hashPassword, PASSWORD_MAX, verifyPasswordOrDummy,
} from '../auth/password.js'
import {
  createSession, deleteSessionByToken, requireSession, revokeAllSessions, revokeFirebaseTokens,
} from '../auth/sessions.js'
import { clearFailures, reserveAttempt } from '../auth/throttle.js'
import { toMs } from '../auth/time.js'
import {
  createVerifiedUser, findUserByEmail, getUser, isAddressTaken, publicUser, recordLogin, type AuthUser,
} from '../auth/users.js'

// Upper bound only; the policy (length, breaches) has its own error codes. Login refuses anything
// longer than the policy allows before hashing, which bounds the CPU cost of one request.
const password = z.string().min(1).max(PASSWORD_MAX * 4)
const code = z.string().regex(/^\d{6}$/)
const name = z.string().trim().min(1).max(80)

const VERIFICATION_SENT: RouteResult = { status: 202, body: { status: 'verification_sent' } }

function tooLong(value: string): boolean {
  return [...value].length > PASSWORD_MAX
}

/** New session (always a new token), replacing any session the browser presented. */
export async function startSession(ctx: RequestContext, user: AuthUser): Promise<RouteResult> {
  await deleteSessionByToken(ctx.req)
  await recordLogin(user.uid)
  const cookie = await createSession(user.uid, ctx.req, ctx.ipPrefix)
  const fresh = (await getUser(user.uid)) ?? user
  return { body: { user: publicUser(fresh) }, headers: { 'Set-Cookie': cookie } }
}

/**
 * The signed-in user, or 401. Ends sessions whose account vanished, was disabled, or changed its
 * password after the session started.
 */
export async function currentUser(
  ctx: RequestContext,
): Promise<{ user: AuthUser; sessionId: string; sessionCreatedAt: number }> {
  const session = await requireSession(ctx.req)
  const user = await getUser(session.uid)
  const changedAt = toMs(user?.passwordChangedAt) ?? 0
  if (!user || user.status !== 'active' || session.createdAt < changedAt) {
    await deleteSessionByToken(ctx.req)
    throw new AppError('unauthorized', 'Not signed in')
  }
  return { user, sessionId: session.id, sessionCreatedAt: session.createdAt }
}

/** Stores a pending registration inside a fresh code and mails it — or mails a notice if taken. */
async function sendRegistrationMail(email: string, password: string, displayName: string | null): Promise<void> {
  // Hash on every path, so a taken address costs the same work as a free one.
  const pendingHash = await hashPassword(password)
  if (await isAddressTaken(email)) {
    await mailer().send({ kind: 'already-registered', to: email })
    return
  }
  const value = await issueCode('verify', emailKey(email), { pendingHash, displayName })
  await mailer().send({ kind: 'verify-code', to: email, code: value })
}

/** Password policy for a new password; a breached-password rejection is journaled (no uid). */
export async function assertNewPassword(ctx: RequestContext, value: string): Promise<void> {
  try {
    await assertAcceptablePassword(value)
  } catch (err) {
    if (isAppError(err) && err.code === 'breached_password') await recordEvent(ctx, { type: 'breached_password_rejected' })
    throw err
  }
}

export const register: Route = {
  method: 'POST',
  path: 'register',
  ipLimits: [LIMITS.registerPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema, password, name: name.optional() }))
    await assertNewPassword(ctx, body.password)
    await enforceLimit(LIMITS.codeRequestPerEmail, emailKey(body.email), ctx.limiter)
    return withMinDuration(async () => {
      await sendRegistrationMail(body.email, body.password, body.name ?? null)
      return VERIFICATION_SENT
    })
  },
}

/** A new code for a pending registration. Needs the password again (nothing is stored without it). */
export const resendVerification: Route = {
  method: 'POST',
  path: 'verify-email/resend',
  ipLimits: [LIMITS.codeRequestPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema, password, name: name.optional() }))
    await assertAcceptablePassword(body.password)
    await enforceLimit(LIMITS.codeRequestPerEmail, emailKey(body.email), ctx.limiter)
    return withMinDuration(async () => {
      await sendRegistrationMail(body.email, body.password, body.name ?? null)
      return VERIFICATION_SENT
    })
  },
}

export const verifyEmail: Route = {
  method: 'POST',
  path: 'verify-email',
  ipLimits: [LIMITS.codeVerifyPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema, code, password }))
    const key = emailKey(body.email)
    await enforceLimit(LIMITS.codeVerifyPerEmail, key, ctx.limiter)
    // The code proves the mailbox; the password proves it is the same person who registered.
    const data = await consumeCode('verify', key, body.code, async (pending) =>
      !tooLong(body.password) && typeof pending.pendingHash === 'string'
      && verifyPasswordOrDummy(pending.pendingHash, body.password))
    if (typeof data.pendingHash !== 'string') throw new AppError('invalid_code', 'Invalid or expired code')
    const user = await createVerifiedUser({
      email: body.email,
      passwordHash: data.pendingHash,
      displayName: data.displayName ?? null,
    })
    if (!user) throw new AppError('invalid_code', 'Invalid or expired code')
    await revokeAllSessions(user.uid) // a taken-over legacy record must not keep old sessions
    await recordEvent(ctx, { uid: user.uid, type: 'register', meta: { method: 'password' } })
    return startSession(ctx, user)
  },
}

export const login: Route = {
  method: 'POST',
  path: 'login',
  ipLimits: [LIMITS.loginPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema, password }))
    return withMinDuration(() => passwordLogin(ctx, body.email, body.password), LOGIN_MIN_MS)
  },
}

/** Login floor: hides the cost difference between unknown, migrated and legacy accounts. */
const LOGIN_MIN_MS = 500

async function passwordLogin(ctx: RequestContext, email: string, plain: string): Promise<RouteResult> {
  const key = emailKey(email)
  const lockIfFails = await reserveAttempt(key)
  const user = await findUserByEmail(email)
  // Same work whether or not the account exists (dummy hash), same answer on every failure.
  const ok = !tooLong(plain) && (await checkLoginPassword(user, plain))
  if (!ok || !user || user.status !== 'active') {
    await recordEvent(ctx, lockIfFails
      ? { uid: user?.uid, type: 'login_locked', meta: { retryAfterSec: lockIfFails.retryAfter ?? 0 } }
      : { uid: user?.uid, type: 'login_failure', meta: { method: 'password', reason: user ? 'wrong_credentials' : 'unknown_account' } })
    throw lockIfFails ?? new AppError('invalid_credentials', 'Wrong email or password')
  }
  await clearFailures(key)
  if (!user.emailVerified) {
    // An imported account whose address was never confirmed. The password is right, but the
    // mailbox is not proven: mail a code (same pending-registration flow) instead of a session.
    await enforceLimit(LIMITS.codeRequestPerEmail, key, ctx.limiter)
    await sendRegistrationMail(email, plain, user.displayName)
    throw new AppError('email_unverified', 'Confirm your email to continue')
  }
  await recordEvent(ctx, { uid: user.uid, type: 'login_success', meta: { method: 'password' } })
  return startSession(ctx, user)
}

export const logout: Route = {
  method: 'POST',
  path: 'logout',
  async handler(ctx) {
    const uid = await deleteSessionByToken(ctx.req)
    if (uid) {
      await revokeFirebaseTokens(uid)
      await recordEvent(ctx, { uid, type: 'logout' })
    }
    return { body: { ok: true }, headers: { 'Set-Cookie': clearSessionCookie() } }
  },
}

export const logoutAll: Route = {
  method: 'POST',
  path: 'logout-all',
  async handler(ctx) {
    const { user } = await currentUser(ctx)
    await revokeAllSessions(user.uid)
    await recordEvent(ctx, { uid: user.uid, type: 'logout_all' })
    return { body: { ok: true }, headers: { 'Set-Cookie': clearSessionCookie() } }
  },
}

export const me: Route = {
  method: 'GET',
  path: 'me',
  async handler(ctx) {
    const { user } = await currentUser(ctx)
    return { body: { user: publicUser(user) } }
  },
}

/** Custom token for the Firestore bridge. Only our session can get one. */
export const firebaseToken: Route = {
  method: 'POST',
  path: 'firebase-token',
  async handler(ctx) {
    const { user } = await currentUser(ctx)
    // bb_cv: credential version — rules reject tokens older than the last credential change.
    const token = await adminAuth().createCustomToken(user.uid, {
      bb_ev: user.emailVerified,
      bb_cv: await credentialVersion(user.uid),
    })
    return { body: { token } }
  },
}
