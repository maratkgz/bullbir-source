// POST client-errors — crash reports from the browser (React error boundary, window.onerror,
// unhandled promise rejections). Lets us see errors that only happen on users' devices (e.g.
// Safari on iPhone) in the server logs. No personal data: message/stack are truncated and run
// through the log redactor; the client never sends user content.
import { z } from 'zod'
import { log } from '../log.js'
import type { Route } from '../router.js'
import { parseBody } from '../validate.js'

const report = z.object({
  kind: z.enum(['render', 'error', 'rejection']),
  message: z.string().max(500),
  stack: z.string().max(2000).optional(),
  component: z.string().max(1000).optional(),
  path: z.string().max(200),
  userAgent: z.string().max(300).optional(),
  release: z.string().max(64).optional(),
})

export const clientErrors: Route = {
  method: 'POST',
  path: 'client-errors',
  ipLimits: [{ name: 'client-errors-ip', limit: 30, windowSeconds: 10 * 60 }],
  async handler(ctx) {
    const body = await parseBody(ctx.req, report)
    // Only the path, never the query string (could carry codes or tokens).
    const path = body.path.split('?')[0]?.split('#')[0] ?? ''
    log.warn('client error', { requestId: ctx.requestId, ...body, path })
    return { status: 202, body: { ok: true } }
  },
}
