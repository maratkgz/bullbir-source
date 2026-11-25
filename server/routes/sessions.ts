// "My devices": list the user's sessions and sign one out.
import { z } from 'zod'
import { AppError } from '../errors.js'
import type { Route } from '../router.js'
import { clearSessionCookie } from '../auth/cookies.js'
import { listSessions, revokeSession } from '../auth/sessions.js'
import { recordEvent } from '../auth/events.js'
import { currentUser } from './auth.js'

const sessionId = z.string().regex(/^[0-9a-f]{32}$/)

export const sessionsList: Route = {
  method: 'GET',
  path: 'sessions',
  async handler(ctx) {
    const { user, sessionId: current } = await currentUser(ctx)
    return { body: { sessions: await listSessions(user.uid, current) } }
  },
}

export const sessionsRevoke: Route = {
  method: 'DELETE',
  path: 'sessions/:id',
  async handler(ctx) {
    const { user, sessionId: current } = await currentUser(ctx)
    const id = sessionId.safeParse(ctx.params.id)
    if (!id.success) throw new AppError('not_found', 'Session not found')
    const wasCurrent = await revokeSession(user.uid, id.data, current)
    await recordEvent(ctx, { uid: user.uid, type: 'session_revoked', meta: { wasCurrent } })
    return wasCurrent
      ? { body: { ok: true }, headers: { 'Set-Cookie': clearSessionCookie() } }
      : { body: { ok: true } }
  },
}
