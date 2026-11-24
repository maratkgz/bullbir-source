// The single Vercel Serverless Function for every /api/auth/* endpoint (see ADR 001: one router
// keeps us under the 12-function limit and gives every route the same protections).
import { createHandler } from '../../server/router.js'
import { routes } from '../../server/routes/index.js'

export default createHandler(routes)
