// One canonical form per address, so "Ann@Mail.com " and "ann@mail.com" are the same account.
import { z } from 'zod'
import { sha256Hex } from './crypto.js'

export function normalizeEmail(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase()
}

/** Stable, non-reversible key for an address (document ids, rate-limit keys, logs). */
export function emailKey(normalized: string): string {
  return sha256Hex(`email:${normalized}`)
}

export const emailSchema = z
  .string()
  .max(254)
  .transform(normalizeEmail)
  .pipe(z.email())
