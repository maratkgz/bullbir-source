// GET /api/auth/health — liveness check. Deliberately reveals nothing about the environment.
import type { Route } from '../router.js'

export const health: Route = {
  method: 'GET',
  path: 'health',
  handler: async () => ({ body: { ok: true } }),
}
