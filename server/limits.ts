// All rate-limit rules in one place (values from docs/auth-migration-plan.md). Per-IP rules stop
// distributed guessing from one machine; per-account rules stop slow guessing from many IPs.
import type { LimitRule } from './rateLimit.js'

const MINUTE = 60
const HOUR = 60 * MINUTE

export const LIMITS = {
  /** Any API call from one IP — a coarse ceiling against floods. */
  apiPerIp: { name: 'api-ip', limit: 120, windowSeconds: MINUTE },
  loginPerIp: { name: 'login-ip', limit: 20, windowSeconds: 10 * MINUTE },
  registerPerIp: { name: 'register-ip', limit: 5, windowSeconds: HOUR },
  codeRequestPerIp: { name: 'code-req-ip', limit: 10, windowSeconds: HOUR },
  codeRequestPerEmail: { name: 'code-req-email', limit: 3, windowSeconds: 15 * MINUTE },
  /** Email-code sign-in: per address+IP (so others can't use up the owner's budget) and overall. */
  otpSendCooldown: { name: 'otp-send-cooldown', limit: 1, windowSeconds: MINUTE },
  otpRequestPerEmailIp: { name: 'otp-req-email-ip', limit: 3, windowSeconds: 15 * MINUTE },
  otpRequestPerEmail: { name: 'otp-req-email', limit: 10, windowSeconds: HOUR },
  /** Google (and later Apple) sign-in: top-level navigations, per IP. */
  oauthStartPerIp: { name: 'oauth-start-ip', limit: 20, windowSeconds: 10 * MINUTE },
  oauthCallbackPerIp: { name: 'oauth-callback-ip', limit: 20, windowSeconds: 10 * MINUTE },
  codeVerifyPerIp: { name: 'code-verify-ip', limit: 30, windowSeconds: 10 * MINUTE },
  /** Survives code re-issue, so replacing a code does not reset the guessing budget. */
  codeVerifyPerEmail: { name: 'code-verify-email', limit: 10, windowSeconds: HOUR },
  resetPerIp: { name: 'reset-ip', limit: 10, windowSeconds: HOUR },
  resetPerEmail: { name: 'reset-email', limit: 3, windowSeconds: HOUR },
} as const satisfies Record<string, LimitRule>
