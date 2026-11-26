// The single Vercel Serverless Function for every /api/auth/* endpoint (see ADR 001: one router
// keeps us under the 12-function limit and gives every route the same protections).
// vercel.json rewrites /api/auth/:path* to /api/auth-router?__path=:path* — Vercel's file-based
// routing does not match multi-segment catch-alls (e.g. oauth/google/start) for plain functions.
import { createHandler } from '../server/router.js'
import { routes } from '../server/routes/index.js'

export default createHandler(routes)
