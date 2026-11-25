# Auth API contract (`/api/auth/*`)

Same-origin JSON API served by `api/auth/[...route].ts`. The browser sends the session cookie
automatically (`credentials: 'same-origin'`). Mutating requests (POST/DELETE) must carry an allowed
`Origin` header (browsers do this) and `Content-Type: application/json` when they have a body.

## Errors

Every error is `{"error": {"code", "message", "requestId"}}`. `message` is for logs/debugging only —
the UI maps `code` to translated text. 429 and 503 also send `Retry-After` (seconds).

| code | HTTP | meaning |
|---|---|---|
| `validation_failed` | 400 | body failed the schema (bad email, missing field…) |
| `bad_request` / `unsupported_media_type` / `payload_too_large` | 400/415/413 | malformed request |
| `invalid_credentials` | 401 | email/password pair wrong **or account does not exist** (same answer on purpose) |
| `invalid_code` | 400 | code wrong, expired, used or burned, or the password does not match the registration (same answer on purpose) |
| `weak_password` | 400 | shorter than 10 or longer than 128 characters |
| `breached_password` | 400 | found in known data breaches (HIBP) |
| `unauthorized` | 401 | no valid session |
| `origin_rejected` | 403 | foreign or missing Origin |
| `email_unverified` | 403 | `login`: password is correct but the (imported) account's email was never confirmed — a verification code was mailed; continue with `verify-email` |
| `password_not_set` | 400 | the account has no password (Google / email-code only) — set one via password reset |
| `reauth_required` | 401 | sensitive action on a passwordless account with a session older than 10 min — sign in again |
| `rate_limited` | 429 | too many attempts (also used while an account is temporarily locked) |
| `service_unavailable` | 503 | dependency down (limiter, mail) |
| `internal` | 500 | bug — details only in server logs |

## User object

```json
{ "uid": "…", "email": "a@b.c", "emailVerified": true, "displayName": "Ann" | null,
  "providers": ["password"], "createdAt": "ISO", "lastLoginAt": "ISO" | null }
```

## Endpoints

| Method & path | Body | Success | Notes |
|---|---|---|---|
| `POST register` | `{email, password, name?}` | `202 {"status":"verification_sent"}` | **Creates nothing yet.** The pending registration (argon2 hash + name) is stored inside the code. Never sets a cookie; identical answer (and response time ≥ 1 s) whether or not the email is taken. Mails a 6-digit code, or a "you already have an account" notice. |
| `POST verify-email` | `{email, code, password}` | `200 {"user"}` + session cookie | Creates the account. The password must equal the one typed at registration — so someone who registers *your* address cannot end up knowing your password. Code: 6 digits, 10 min, single use, 5 attempts; 10 checks/hour per address. |
| `POST verify-email/resend` | `{email, password, name?}` | `202 {"status":"verification_sent"}` | Same as register (replaces the pending registration). Always the same answer. |
| `POST login` | `{email, password}` | `200 {"user"}` + session cookie | Only verified, active accounts. Correct password on an unverified account (imported from Firebase) → `403 email_unverified`, no session, and a verification code is mailed (same pending-registration flow; the client shows the code screen and finishes with `verify-email`). Accounts imported from Firebase are checked against the legacy scrypt hash once, then re-hashed with argon2id (stage 3). 5 attempts → `rate_limited` (15 min, doubling up to 24 h); attempts are reserved before the password check, so parallel requests cannot exceed it. Any presented old session is ended. |
| `POST otp/request` | `{email}` | `202 {"status":"code_sent"}` + cookie `__Host-otp` | Sign in without a password. Same answer, cookie and timing (≥ 1 s) for every address; an **8-digit** code is mailed only to an existing active account (mail text shows device and time; no code in the subject). The cookie binds the code to this browser: each browser has its own code, which nobody else can replace, guess or burn. Limits: 1/min and 3/15 min per address+IP, 10/h per address, 10/h per IP. A mail outage still answers 202. |
| `POST otp/verify` | `{email, code}` (needs the `__Host-otp` cookie) | `200 {"user"}` + session cookie, `__Host-otp` cleared | 10 min, single use, 5 attempts; 10 checks/hour per address+browser; ≥ 300 ms; any failure → `invalid_code`. Proves the mailbox: confirms an unverified imported account (its old password, provider links and sessions are wiped) and lifts a password lockout (the escalation level stays). |
| `GET oauth/google/start` | – (top-level navigation) | `302` → Google, cookie `__Host-oauth` | Authorization code + PKCE (S256) + state + nonce; the flow cookie is AES-GCM sealed, 10 min. 20/10 min per IP. HEAD not allowed. Without `GOOGLE_CLIENT_ID/SECRET` → `302 /login?error=oauth_unavailable`. |
| `GET oauth/google/callback` | – (Google redirects here) | `302 /app` + session cookie, or `302 /login?error=oauth_*` | Checks state against the cookie, exchanges the code, verifies the ID token (RS256, iss, aud, exp, nonce, `email_verified`). Account rules: existing link by `sub` → sign in; no account → create (verified, no password); existing account with the same email → linked **only** for `@gmail.com`/`@googlemail.com` addresses verified on both sides (other domains can change owners) — otherwise `oauth_link_unverified`; address only in legacy Firebase Auth → `oauth_account_exists`; disabled account → `oauth_failed`. A new link mails the owner a notice. Error codes: `oauth_cancelled`, `oauth_failed`, `oauth_email_unverified`, `oauth_email_missing`, `oauth_link_unverified`, `oauth_account_exists`, `oauth_unavailable`. |
| `POST password/reset-request` | `{email}` | `202 {"status":"code_sent"}` + cookie `__Host-otp` | Forgot password. Same answer/cookie/timing (≥ 1 s) for every address; an 8-digit code (mail kind `reset-code`) only for an existing active account. Same limits as `otp/request`. |
| `POST password/reset-confirm` | `{email, code, newPassword}` (needs `__Host-otp`) | `200 {"user"}` + new session cookie | Password policy first (`weak_password`, `breached_password`). Proves the mailbox: an unverified account is confirmed (old credentials/links wiped). Sets the password, ends **all** sessions + Firebase tokens, lifts the lockout, starts a fresh session. Failures → `invalid_code`. |
| `POST password/change` | `{currentPassword, newPassword}` (session) | `200 {"user"}` + new session cookie | Wrong current password → `invalid_credentials` (counts toward the lockout). Account without a password (Google / code only) → `password_not_set` (use reset to set one). Ends all other sessions + Firebase tokens; this browser gets a new session. |
| `POST email/change-request` | `{newEmail, currentPassword?}` (session) | `202 {"status":"code_sent"}` + cookie `__Host-otp` | Re-auth: `currentPassword` required if the account has a password (`invalid_credentials`), otherwise the session must be younger than 10 min (`reauth_required`). Mails an 8-digit code to the NEW address; if it is already taken, the new address gets an "already registered" notice instead — same answer. |
| `POST email/change-confirm` | `{newEmail, code}` (session + `__Host-otp`) | `200 {"user"}` + new session cookie | Moves the account to the new address (verified), notifies the OLD address, ends all other sessions + Firebase tokens. Taken meanwhile / wrong code → `invalid_code`. |
| `POST account/delete` | `{currentPassword?}` (session) | `200 {"ok":true}` + cookie cleared | Same re-auth rule as email change. Deletes `users/{uid}` with all sub-collections, the account records (`users_auth`, `auth_emails`, `auth_accounts`, codes, lock), all sessions and the user's Firebase Auth record. The client deletes the avatar in Storage and its local cache first. Irreversible. |
| `POST logout` | – | `200 {"ok":true}` + cookie cleared | Works without a session. Also revokes Firebase refresh tokens (other devices silently re-bridge). |
| `POST logout-all` | – | `200 {"ok":true}` + cookie cleared | All sessions + Firebase refresh tokens revoked. |
| `GET me` | – | `200 {"user"}` | `401 unauthorized` without a session. |
| `GET sessions` | – | `200 {"sessions":[{id, current, device, ipPrefix, createdAt, lastSeenAt}]}` | |
| `DELETE sessions/:id` | – | `200 {"ok":true}` | Revoking the current one also clears the cookie. Revokes Firebase refresh tokens. |
| `POST firebase-token` | – | `200 {"token"}` | Custom token for `signInWithCustomToken`; claim `bb_ev` = emailVerified. |

## Session cookie

`__Host-session` — 32 random bytes (base64url), `HttpOnly; Secure; SameSite=Lax; Path=/`.
Stored server-side only as SHA-256. Expires after 7 days without activity, 30 days at most
(cookie `Max-Age` is 30 days; the server enforces the idle limit). A session also ends when the
account is disabled or its password changes.
A new token is issued on every login. Firebase Auth on the client is only a bridge
(`inMemoryPersistence`): after reload the client calls `firebase-token` again.
