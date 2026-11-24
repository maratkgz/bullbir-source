// "Security activity": the signed-in user's latest security events (no meta, no secrets).
import type { Route } from '../router.js'
import { listSecurityEvents } from '../auth/events.js'
import { currentUser } from './auth.js'

export const securityEvents: Route = {
  method: 'GET',
  path: 'security-events',
  async handler(ctx) {
    const { user } = await currentUser(ctx)
    return { body: { events: await listSecurityEvents(user.uid) } }
  },
}
