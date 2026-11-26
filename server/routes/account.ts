// Stage 7: password reset / change, email change, account deletion. Contract: docs/auth-api.md.
// Every sensitive action re-checks the person with the CURRENT PASSWORD (a stolen session alone is
// never enough — passwordless accounts set a password via reset first) and ends all other
// sessions, Firebase refresh tokens and (via the credential version) every bridge token.
import { z } from 'zod'
import { AppError } from '../errors.js'
import { LIMITS } from '../limits.js'
import { log } from '../log.js'
import { enforceLimit } from '../rateLimit.js'
import type { RequestContext, Route, RouteResult } from '../router.js'
import { parseBody } from '../validate.js'
import { changeAccountEmail, deleteAccount, dropPendingCodes, isAddressAvailable, setPassword } from '../auth/accountOps.js'
import { EMAIL_CODE_DIGITS, clearOtpCookie, mailTimestamp, newChallenge, requireChallenge } from '../auth/challenge.js'
import { clearSessionCookie } from '../auth/cookies.js'
import { deviceLabel } from '../auth/device.js'
import { emailKey, emailSchema } from '../auth/email.js'
import { mailer, type AuthMail } from '../auth/mailer.js'
import { consumeCode, issueCode } from '../auth/otp.js'
import { withMinDuration } from '../auth/pacing.js'
import { hashPassword, PASSWORD_MAX } from '../auth/password.js'
import { checkLoginPassword } from '../auth/passwordCheck.js'
import { revokeAllSessions } from '../auth/sessions.js'
import { clearFailures, reserveAttempt } from '../auth/throttle.js'
import { claimUnverifiedAccount, findUserByEmail, getUser, type AuthUser } from '../auth/users.js'
import { recordEvent } from '../auth/events.js'
import { assertNewPassword, currentUser, startSession } from './auth.js'

const password = z.string().min(1).max(PASSWORD_MAX * 4)
const code = z.string().regex(new RegExp(`^\\d{${EMAIL_CODE_DIGITS}}$`))
const VERIFY_MIN_MS = 300

const CODE_SENT = { status: 'code_sent' } as const

function invalidCode(): AppError {
  return new AppError('invalid_code', 'Invalid or expired code')
}

function hasPassword(user: AuthUser): boolean {
  return Boolean(user.passwordHash || user.legacyPassword)
}

/** Sends a security mail; an outage is logged but never changes the answer. */
async function sendQuietly(mail: AuthMail): Promise<void> {
  try {
    await mailer().send(mail)
  } catch (err) {
    log.error('account mail failed', { kind: mail.kind, err })
  }
}

/** Proves it's still the account owner: the current password, counted by the lockout like a login. */
async function reauthenticate(user: AuthUser, currentPassword?: string): Promise<void> {
  if (!hasPassword(user)) throw new AppError('password_not_set', 'Set a password first (password reset)')
  if (!currentPassword) throw new AppError('invalid_credentials', 'Current password required')
  const key = emailKey(user.email)
  const lockIfFails = await reserveAttempt(key)
  const ok = [...currentPassword].length <= PASSWORD_MAX && (await checkLoginPassword(user, currentPassword))
  if (!ok) throw lockIfFails ?? new AppError('invalid_credentials', 'Wrong password')
  await clearFailures(key)
}

/** Ends every session, then gives this browser a fresh one (rotation after a credential change). */
async function freshSessionOnly(ctx: RequestContext, uid: string, extraCookies: string[] = []): Promise<RouteResult> {
  await revokeAllSessions(uid)
  const user = await getUser(uid)
  if (!user) throw new AppError('unauthorized', 'Not signed in')
  const result = await startSession(ctx, user)
  const cookies = [result.headers?.['Set-Cookie'], ...extraCookies].flat().filter((c): c is string => !!c)
  return { ...result, headers: { ...result.headers, 'Set-Cookie': cookies } }
}

// ------------------------------------------------------------------ password reset

export const resetRequest: Route = {
  method: 'POST',
  path: 'password/reset-request',
  ipLimits: [LIMITS.resetPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema }))
    const key = emailKey(body.email)
    await enforceLimit(LIMITS.otpSendCooldown, `reset:${key}:${ctx.ipKey}`, ctx.limiter)
    await enforceLimit(LIMITS.resetPerEmail, key, ctx.limiter)
    const challenge = newChallenge()
    return withMinDuration(async (): Promise<RouteResult> => {
      const user = await findUserByEmail(body.email)
      if (user && user.status === 'active') {
        const value = await issueCode('reset', key, { uid: user.uid }, { challenge: challenge.hash, digits: EMAIL_CODE_DIGITS })
        await sendQuietly({ kind: 'reset-code', to: user.email, code: value, device: deviceLabel(ctx.req), at: mailTimestamp() })
      }
      return { status: 202, body: CODE_SENT, headers: { 'Set-Cookie': challenge.setCookie } }
    })
  },
}

export const resetConfirm: Route = {
  method: 'POST',
  path: 'password/reset-confirm',
  ipLimits: [LIMITS.codeVerifyPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema, code, newPassword: password }))
    await assertNewPassword(ctx, body.newPassword)
    return withMinDuration(async () => {
      const challenge = requireChallenge(ctx.req)
      const key = emailKey(body.email)
      await enforceLimit(LIMITS.codeVerifyPerEmail, `${key}:${challenge}`, ctx.limiter)
      const { uid } = await consumeCode('reset', key, body.code, undefined, { challenge })
      const user = uid ? await getUser(uid) : null
      if (!user || user.email !== body.email || user.status !== 'active') throw invalidCode()
      if (!user.emailVerified) {
        // The code proves the mailbox: wipe whatever the record's creator set (pre-hijack defence).
        await revokeAllSessions(user.uid)
        await claimUnverifiedAccount(user.uid)
      }
      await setPassword(user.uid, await hashPassword(body.newPassword))
      await dropPendingCodes(user.uid)
      await clearFailures(key)
      const result = await freshSessionOnly(ctx, user.uid, [clearOtpCookie()])
      await recordEvent(ctx, { uid: user.uid, type: 'password_reset' })
      await sendQuietly({ kind: 'password-changed', to: user.email, device: deviceLabel(ctx.req), at: mailTimestamp() })
      return result
    }, VERIFY_MIN_MS)
  },
}

// ------------------------------------------------------------------ password change

export const passwordChange: Route = {
  method: 'POST',
  path: 'password/change',
  async handler(ctx) {
    const { user } = await currentUser(ctx)
    const body = await parseBody(ctx.req, z.object({ currentPassword: password, newPassword: password }))
    if (!hasPassword(user)) throw new AppError('password_not_set', 'This account has no password yet')
    await assertNewPassword(ctx, body.newPassword)
    await reauthenticate(user, body.currentPassword)
    await setPassword(user.uid, await hashPassword(body.newPassword))
    await dropPendingCodes(user.uid)
    const result = await freshSessionOnly(ctx, user.uid)
    await recordEvent(ctx, { uid: user.uid, type: 'password_changed' })
    await sendQuietly({ kind: 'password-changed', to: user.email, device: deviceLabel(ctx.req), at: mailTimestamp() })
    return result
  },
}

// ------------------------------------------------------------------ email change

export const emailChangeRequest: Route = {
  method: 'POST',
  path: 'email/change-request',
  ipLimits: [LIMITS.codeRequestPerIp],
  async handler(ctx) {
    const { user } = await currentUser(ctx)
    const body = await parseBody(ctx.req, z.object({ newEmail: emailSchema, currentPassword: password.optional() }))
    // Password first (counted by the lockout), so a typo doesn't use up the send cooldown.
    await reauthenticate(user, body.currentPassword)
    await enforceLimit(LIMITS.otpSendCooldown, `change:${user.uid}`, ctx.limiter)
    await enforceLimit(LIMITS.otpRequestPerEmail, `change:${user.uid}`, ctx.limiter)
    // Per recipient, too: nobody may flood someone else's mailbox from many accounts.
    await enforceLimit(LIMITS.otpRequestPerEmailIp, `change-to:${emailKey(body.newEmail)}`, ctx.limiter)
    const challenge = newChallenge()
    return withMinDuration(async (): Promise<RouteResult> => {
      const meta = { device: deviceLabel(ctx.req), at: mailTimestamp() }
      if (body.newEmail === user.email || !(await isAddressAvailable(body.newEmail))) {
        if (body.newEmail !== user.email) await sendQuietly({ kind: 'already-registered', to: body.newEmail })
      } else {
        const value = await issueCode('change_email', emailKey(body.newEmail), { uid: user.uid }, {
          challenge: challenge.hash,
          digits: EMAIL_CODE_DIGITS,
        })
        await sendQuietly({ kind: 'email-change-code', to: body.newEmail, code: value, ...meta })
      }
      return { status: 202, body: CODE_SENT, headers: { 'Set-Cookie': challenge.setCookie } }
    })
  },
}

export const emailChangeConfirm: Route = {
  method: 'POST',
  path: 'email/change-confirm',
  ipLimits: [LIMITS.codeVerifyPerIp],
  async handler(ctx) {
    const { user } = await currentUser(ctx)
    const body = await parseBody(ctx.req, z.object({ newEmail: emailSchema, code }))
    return withMinDuration(async () => {
      const challenge = requireChallenge(ctx.req)
      const key = emailKey(body.newEmail)
      await enforceLimit(LIMITS.codeVerifyPerEmail, `${key}:${challenge}`, ctx.limiter)
      const data = await consumeCode('change_email', key, body.code, undefined, { challenge })
      if (data.uid !== user.uid) throw invalidCode()
      if (!(await changeAccountEmail(user.uid, user.email, body.newEmail))) throw invalidCode()
      await dropPendingCodes(user.uid)
      await recordEvent(ctx, { uid: user.uid, type: 'email_changed' })
      // Tell the OLD address — the owner must learn about it even if the session was stolen.
      await sendQuietly({
        kind: 'email-changed', to: user.email, newEmail: body.newEmail, device: deviceLabel(ctx.req), at: mailTimestamp(),
      })
      return freshSessionOnly(ctx, user.uid, [clearOtpCookie()])
    }, VERIFY_MIN_MS)
  },
}

// ------------------------------------------------------------------ account deletion

export const accountDelete: Route = {
  method: 'POST',
  path: 'account/delete',
  timeoutMs: 25_000,
  async handler(ctx) {
    const { user } = await currentUser(ctx)
    const body = await parseBody(ctx.req, z.object({ currentPassword: password.optional() }))
    await reauthenticate(user, body.currentPassword)
    await deleteAccount(user.uid, user.email)
    // Without uid: the user's journal is deleted with the account; this only counts deletions.
    await recordEvent(ctx, { type: 'account_deleted' })
    await sendQuietly({ kind: 'account-deleted', to: user.email, device: deviceLabel(ctx.req), at: mailTimestamp() })
    log.info('account deleted', { requestId: ctx.requestId })
    return { body: { ok: true }, headers: { 'Set-Cookie': clearSessionCookie() } }
  },
}

export const accountRoutes: readonly Route[] = [
  resetRequest, resetConfirm, passwordChange, emailChangeRequest, emailChangeConfirm, accountDelete,
]
