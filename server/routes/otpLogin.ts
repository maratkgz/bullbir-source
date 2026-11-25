// Stage 4: sign in with a one-time code sent by email (no password). Contract: docs/auth-api.md.
//   POST otp/request {email}        → always 202 {status:'code_sent'}
//   POST otp/verify  {email, code}  → 200 {user} + session cookie, or 400 invalid_code
// Receiving the code proves the address is yours, so a code login also marks the email verified.
import { z } from 'zod'
import { AppError } from '../errors.js'
import { LIMITS } from '../limits.js'
import { enforceLimit } from '../rateLimit.js'
import type { Route } from '../router.js'
import { startSession } from './auth.js'
import { parseBody } from '../validate.js'
import { emailKey, emailSchema } from '../auth/email.js'
import { mailer } from '../auth/mailer.js'
import { consumeCode, issueCode } from '../auth/otp.js'
import { revokeAllSessions } from '../auth/sessions.js'
import { claimUnverifiedAccount, findUserByEmail, getUser } from '../auth/users.js'

const code = z.string().regex(/^\d{6}$/)

export const CODE_SENT = { status: 202, body: { status: 'code_sent' } } as const

function invalidCode(): AppError {
  return new AppError('invalid_code', 'Invalid or expired code')
}

export const requestLoginCode: Route = {
  method: 'POST',
  path: 'otp/request',
  ipLimits: [LIMITS.codeRequestPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema }))
    const key = emailKey(body.email)
    await enforceLimit(LIMITS.codeRequestPerEmail, key, ctx.limiter)
    const user = await findUserByEmail(body.email)
    // No account → nothing is sent, but the answer is the same (no account enumeration).
    if (user) {
      const value = await issueCode('login', key, { uid: user.uid })
      // TODO(lead): switch to a dedicated 'login-code' mail kind once AuthMail has one.
      await mailer().send({ kind: 'verify-code', to: user.email, code: value })
    }
    return CODE_SENT
  },
}

export const verifyLoginCode: Route = {
  method: 'POST',
  path: 'otp/verify',
  ipLimits: [LIMITS.codeVerifyPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema, code }))
    const { uid } = await consumeCode('login', emailKey(body.email), body.code)
    if (!uid) throw invalidCode()
    const user = await getUser(uid)
    // Account deleted or its address changed since the code was issued → same answer as a wrong code.
    if (!user || user.email !== body.email) throw invalidCode()
    if (!user.emailVerified) {
      // Pre-hijack defence: wipe credentials of whoever created the record, end their sessions.
      await claimUnverifiedAccount(uid)
      await revokeAllSessions(uid)
    }
    return startSession(ctx, { ...user, emailVerified: true })
  },
}

export const otpLoginRoutes: readonly Route[] = [requestLoginCode, verifyLoginCode]
