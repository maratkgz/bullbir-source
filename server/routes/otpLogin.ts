// Stage 4: sign in with a one-time code sent by email (no password). Contract: docs/auth-api.md.
//   POST otp/request {email}        → always 202 {status:'code_sent'} (≥ 1 s, same for every address)
//                                     + HttpOnly cookie __Host-otp binding the code to this browser
//   POST otp/verify  {email, code}  → 200 {user} + session cookie, or 400 invalid_code
// The code is 8 digits and belongs to the browser that asked for it: other browsers can neither
// replace, guess against nor burn it. Receiving the code proves the mailbox, so it also:
//   - confirms an unverified (imported) account, wiping whatever credentials its creator set;
//   - lifts a password lockout — the owner's way in when someone keeps guessing their password.
import { z } from 'zod'
import { AppError } from '../errors.js'
import { LIMITS } from '../limits.js'
import { log } from '../log.js'
import { enforceLimit } from '../rateLimit.js'
import type { RequestContext, Route, RouteResult } from '../router.js'
import { parseBody } from '../validate.js'
import { clearOtpCookie, otpCookie, readOtpChallenge } from '../auth/cookies.js'
import { randomToken, sha256Hex } from '../auth/crypto.js'
import { deviceLabel } from '../auth/device.js'
import { emailKey, emailSchema } from '../auth/email.js'
import { mailer } from '../auth/mailer.js'
import { CODE_TTL_MS, consumeCode, issueCode } from '../auth/otp.js'
import { withMinDuration } from '../auth/pacing.js'
import { revokeAllSessions } from '../auth/sessions.js'
import { liftLock } from '../auth/throttle.js'
import { now } from '../auth/time.js'
import { claimUnverifiedAccount, findUserByEmail, getUser } from '../auth/users.js'
import { startSession } from './auth.js'

export const LOGIN_CODE_DIGITS = 8
const code = z.string().regex(new RegExp(`^\\d{${LOGIN_CODE_DIGITS}}$`))
const VERIFY_MIN_MS = 300

function invalidCode(): AppError {
  return new AppError('invalid_code', 'Invalid or expired code')
}

/** Creates and mails a code if the account exists. Never fails differently for unknown addresses. */
async function sendLoginCode(ctx: RequestContext, email: string, challenge: string): Promise<void> {
  const user = await findUserByEmail(email)
  if (!user || user.status !== 'active') return
  const value = await issueCode('login', emailKey(email), { uid: user.uid }, { challenge, digits: LOGIN_CODE_DIGITS })
  try {
    await mailer().send({
      kind: 'login-code',
      to: user.email,
      code: value,
      device: deviceLabel(ctx.req),
      at: new Date(now()).toISOString().slice(0, 16).replace('T', ' '),
    })
  } catch (err) {
    // A mail outage must not turn this endpoint into an "account exists" oracle.
    log.error('login code mail failed', { err })
  }
}

export const requestLoginCode: Route = {
  method: 'POST',
  path: 'otp/request',
  ipLimits: [LIMITS.codeRequestPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema }))
    const key = emailKey(body.email)
    // Per address+IP, so others can't use up the owner's budget; plus an overall cap per address.
    await enforceLimit(LIMITS.otpSendCooldown, `${key}:${ctx.ipKey}`, ctx.limiter)
    await enforceLimit(LIMITS.otpRequestPerEmailIp, `${key}:${ctx.ipKey}`, ctx.limiter)
    await enforceLimit(LIMITS.otpRequestPerEmail, key, ctx.limiter)
    const challenge = randomToken()
    return withMinDuration(async (): Promise<RouteResult> => {
      await sendLoginCode(ctx, body.email, sha256Hex(challenge))
      return {
        status: 202,
        body: { status: 'code_sent' },
        // Set for every address, so the cookie itself reveals nothing.
        headers: { 'Set-Cookie': otpCookie(challenge, Math.floor(CODE_TTL_MS / 1000)) },
      }
    })
  },
}

export const verifyLoginCode: Route = {
  method: 'POST',
  path: 'otp/verify',
  ipLimits: [LIMITS.codeVerifyPerIp],
  async handler(ctx) {
    const body = await parseBody(ctx.req, z.object({ email: emailSchema, code }))
    return withMinDuration(() => verify(ctx, body.email, body.code), VERIFY_MIN_MS)
  },
}

async function verify(ctx: RequestContext, email: string, value: string): Promise<RouteResult> {
  const raw = readOtpChallenge(ctx.req)
  if (!raw) throw invalidCode()
  const challenge = sha256Hex(raw)
  const key = emailKey(email)
  await enforceLimit(LIMITS.codeVerifyPerEmail, `${key}:${challenge}`, ctx.limiter)
  const { uid } = await consumeCode('login', key, value, undefined, { challenge })
  if (!uid) throw invalidCode()
  const user = await getUser(uid)
  // Account deleted, disabled or its address changed since the code was issued → same answer.
  if (!user || user.email !== email || user.status !== 'active') throw invalidCode()
  if (!user.emailVerified) {
    // Pre-hijack defence: end the creator's sessions first, then wipe their credentials.
    await revokeAllSessions(uid)
    await claimUnverifiedAccount(uid)
  }
  await liftLock(key)
  const fresh = (await getUser(uid)) ?? user
  const result = await startSession(ctx, fresh)
  const cookies = [result.headers?.['Set-Cookie'], clearOtpCookie()].flat().filter((c): c is string => !!c)
  return { ...result, headers: { ...result.headers, 'Set-Cookie': cookies } }
}

export const otpLoginRoutes: readonly Route[] = [requestLoginCode, verifyLoginCode]
