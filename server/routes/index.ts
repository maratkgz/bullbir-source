// Every /api/auth route. The router applies Origin checks, limits and error handling to all.
import type { Route } from '../router.js'
import { health } from './health.js'
import { firebaseToken, login, logout, logoutAll, me, register, resendVerification, verifyEmail } from './auth.js'
import { sessionsList, sessionsRevoke } from './sessions.js'
import { otpLoginRoutes } from './otpLogin.js'

export const routes: readonly Route[] = [
  health,
  register,
  verifyEmail,
  resendVerification,
  login,
  logout,
  logoutAll,
  me,
  firebaseToken,
  sessionsList,
  sessionsRevoke,
  ...otpLoginRoutes,
]
