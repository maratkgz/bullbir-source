import { describe, expect, it } from 'vitest'
import { accountId, decideLink, isGoogleMailbox } from '../../server/auth/oauth/accounts.js'
import { OAuthError } from '../../server/auth/oauth/provider.js'

const verified = { emailVerified: true, email: 'ann@gmail.com' }
const unverified = { emailVerified: false, email: 'ann@gmail.com' }
const verifiedCorp = { emailVerified: true, email: 'ann@corp.example' }

describe('account linking rules', () => {
  it('1. an existing link for this sub signs in, whatever the email says', () => {
    expect(decideLink({ linkedUid: 'u1', existingUser: null, identity: unverified })).toEqual({ action: 'sign_in', uid: 'u1' })
    expect(decideLink({ linkedUid: 'u1', existingUser: { uid: 'u2', emailVerified: true }, identity: verified }))
      .toEqual({ action: 'sign_in', uid: 'u1' })
  })

  it('2. links to an account with the same email only when both sides verified it', () => {
    expect(decideLink({ linkedUid: null, existingUser: { uid: 'u2', emailVerified: true }, identity: verified }))
      .toEqual({ action: 'link', uid: 'u2' })
  })

  it('2. refuses when our account has not verified the address (squatted registration)', () => {
    expect(decideLink({ linkedUid: null, existingUser: { uid: 'u2', emailVerified: false }, identity: verified }))
      .toEqual({ action: 'refuse', reason: 'link_unverified' })
  })

  it('2. refuses when the provider has not verified the address', () => {
    expect(decideLink({ linkedUid: null, existingUser: { uid: 'u2', emailVerified: true }, identity: unverified }))
      .toEqual({ action: 'refuse', reason: 'link_unverified' })
  })

  it('2. never auto-links a non-Google mailbox (domain may have changed hands)', () => {
    expect(decideLink({ linkedUid: null, existingUser: { uid: 'u2', emailVerified: true }, identity: verifiedCorp }))
      .toEqual({ action: 'refuse', reason: 'link_unverified' })
  })

  it('2. refuses to link a disabled account', () => {
    expect(decideLink({ linkedUid: null, existingUser: { uid: 'u2', emailVerified: true, active: false }, identity: verified }))
      .toEqual({ action: 'refuse', reason: 'invalid_state' })
  })

  it('recognises Google mailboxes only', () => {
    expect(isGoogleMailbox('a@gmail.com')).toBe(true)
    expect(isGoogleMailbox('a@GoogleMail.com')).toBe(true)
    expect(isGoogleMailbox('a@gmail.com.evil.test')).toBe(false)
    expect(isGoogleMailbox('gmail.com@corp.example')).toBe(false)
  })

  it('3. creates an account when nothing matches (any domain)', () => {
    expect(decideLink({ linkedUid: null, existingUser: null, identity: verifiedCorp })).toEqual({ action: 'create' })
    expect(decideLink({ linkedUid: null, existingUser: null, identity: verified })).toEqual({ action: 'create' })
  })
})

describe('auth_accounts document id', () => {
  it('is {providerId}:{sub}', () => {
    expect(accountId('google.com', '1101694')).toBe('google.com:1101694')
  })

  it('refuses ids that would escape the collection', () => {
    expect(() => accountId('google.com', 'a/b')).toThrow(OAuthError)
    expect(() => accountId('google.com', '')).toThrow(OAuthError)
  })
})
