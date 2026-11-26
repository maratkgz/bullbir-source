# BullBir

All-in-one personal productivity web app (a premium alternative to Notion) — built as an installable **PWA**.

One space for your life, work, and self-development: tasks, journal, calendar, finance, mood, notes, goals & habits, pomodoro, reminders, and a 9×9 Mandala chart. Fully trilingual (English / Kyrgyz / Русский), with light & dark themes, fluid Framer Motion animations, and offline support.

Sign-in runs on **BullBir's own authentication server** (TypeScript on Vercel Functions) — not a
hosted auth SDK. Firebase Auth is kept only as an invisible bridge so Firestore and Storage
security rules keep working.

## Authentication

- **Email + password** — the account is created only after the 6-digit code from the email is
  entered together with the same password (nobody can pre-register your address and know your
  password). Passwords: 10–128 characters, checked against known breaches (HIBP, k-anonymity),
  hashed with **argon2id**.
- **Sign in with an email code** — 8-digit one-time code bound to the browser that asked for it.
- **Google** — server-side OAuth 2.0 / OpenID Connect (authorization code + PKCE + state + nonce).
- **Sessions & devices** — httpOnly `__Host-session` cookie (7 days idle, 30 days max), "My devices"
  list, sign out of one device or everywhere.
- **Security journal** — sign-ins, failures, lockouts, sign-outs, password/email changes, Google
  linking, rejected breached passwords; no secrets stored, kept 180 days.
- **Password reset & change, email change, account deletion** (deletes all data and the avatar).
- **Brute-force protection** — per-IP and per-account rate limits (Upstash Redis), temporary
  account lockout with exponential back-off, identical answers and timing for unknown addresses.
- **Lazy migration** — existing Firebase Auth users are imported with the same uid; their old
  scrypt hash is checked once and re-hashed with argon2id on first sign-in.

Details: [architecture](docs/architecture.md) · [security review](docs/security-review.md) ·
[API contract](docs/auth-api.md) · [ADR 001 — own auth](docs/adr/001-own-auth.md) ·
[deploy checklist (RU)](docs/deploy-checklist.md).

## Architecture in brief

```
Browser (React PWA) ──/api/auth/*──▶ Vercel Function (one router, TypeScript strict)
      │   httpOnly session cookie        │  Origin check → rate limit → zod → handler → safe log
      │                                  ├─ Firestore via Admin SDK: users_auth, sessions, otp_codes,
      │                                  │  auth_emails, auth_accounts, auth_throttle, security_events
      │                                  ├─ Upstash Redis (rate limits) · Resend (mail) · HIBP
      │◀── Firebase custom token (claim bb_ev = email verified)
      ▼
signInWithCustomToken (in-memory) ──▶ Firestore / Storage, guarded by rules that check bb_ev
```

Server-only collections are closed to the client by the rules. Sign-out, "sign out everywhere"
and password changes also revoke the Firebase refresh tokens, so the bridge never outlives the
session. Full write-up: [docs/architecture.md](docs/architecture.md).

## Stack

- **React 18** + **Vite**
- **CSS Custom Properties** (no UI kit, no Tailwind, no Bootstrap)
- **Framer Motion** — all animation
- **Firebase** — Firestore (with offline persistence) + Storage; Auth only as a custom-token bridge
- **TypeScript server on Vercel Functions** (`api/`, `server/`) — strict mode
- **zod** — request and environment validation
- **argon2id** (`@node-rs/argon2`) — password hashing
- **Upstash Redis** (`@upstash/ratelimit`) — rate limiting
- **Resend** — transactional email
- **HIBP Pwned Passwords** — breached-password check
- **firebase-admin** — custom tokens, server-side Firestore
- **Vitest** + **Firebase emulators** (`@firebase/rules-unit-testing`) — tests
- **vite-plugin-pwa** — manifest, service worker, install prompt
- **@dnd-kit** — Kanban drag & drop
- **Tiptap** — rich text (Journal & Notes)
- **Recharts** — Finance & Mood charts
- **date-fns** — date logic
- **lucide-react** — icons

## Getting started (local, on emulators)

Requirements: **Node 22+**, **Java 21** (for the Firebase emulators), Firebase CLI
(`npm i -g firebase-tools`).

```bash
# 1. Install dependencies
npm install

# 2. Local settings (gitignored)
cp .env.example .env.local
#    - keep VITE_USE_EMULATORS=true and the *_EMULATOR_HOST lines
#    - set AUTH_PEPPER to a fresh random value:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Start the emulators (auth, firestore, storage; project demo-bullbir) — separate terminal
npm run emulators

# 4. Run the dev server — it also serves /api/auth/* locally
npm run dev            # http://localhost:5173
```

No real Firebase project, mail service or Redis is needed locally: emails are not sent — the
codes are printed in the dev-server terminal as `[dev-mail]` lines. Google sign-in is optional
locally (see [docs/google-oauth-setup.md](docs/google-oauth-setup.md)); without keys the button
reports "temporarily unavailable" and everything else works.

Production build: `npm run build`, `npm run preview`.

## Tests & checks

```bash
npm test               # Vitest unit tests (tests/unit) — no emulator needed
npm run test:emulator  # Firestore/Storage rules + auth API flows on the emulators (needs Java 21)
npm run typecheck      # tsc for api/, server/, tests/, scripts/ (strict)
npm run lint           # eslint
```

There are no automated UI/e2e tests; UI behaviour is checked manually in the browser.

## Environment variables

Local values: [`.env.example`](.env.example). Production setup step by step (where to get each
key, which ones are secrets): [docs/deploy-checklist.md](docs/deploy-checklist.md).

| Variable | Where | Description |
| --- | --- | --- |
| `VITE_FIREBASE_*` | client | Firebase web config (API key, auth domain, project, bucket, sender, app ID) |
| `FIREBASE_PROJECT_ID` | server | Firebase project ID |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | server, secret | Admin SDK service-account JSON, base64 |
| `FIREBASE_STORAGE_BUCKET` | server | Bucket, for deleting avatars on account deletion |
| `APP_ORIGINS` | server | Allowed site origins (CSRF check), comma-separated, https in production |
| `AUTH_PEPPER` | server, secret | ≥ 32 random bytes, base64 — HMAC key for one-time codes |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | server, secret | Rate limiter |
| `RESEND_API_KEY` / `MAIL_FROM` | server, secret | Email sending, from a verified domain |
| `FIREBASE_HASH_*` | server, secret | Firebase password-hash parameters for lazy migration |
| `GOOGLE_CLIENT_ID` / `_SECRET`, `OAUTH_REDIRECT_BASE` | server, secret | Google sign-in (optional) |
| `VITE_USE_EMULATORS`, `*_EMULATOR_HOST` | local only | Never set on Vercel — the server refuses to start |

The server validates its environment at start-up (`server/env.ts`) and refuses to run with a
missing or malformed secret.

## Data model

All user data lives under `users/{uid}`:

```
users/{uid}                         # profile, onboardingDone, language, theme
users/{uid}/tasks/{id}              # title, description, status, priority, tags[], deadline, subtasks[]
users/{uid}/journalEntries/{id}     # content (HTML), mood, private
users/{uid}/events/{id}            # title, date, time, allDay, category, color
users/{uid}/transactions/{id}      # type, amount, category, note, date, currency
users/{uid}/moods/{YYYY-MM-DD}     # value (0-4), note
users/{uid}/notes/{id}             # title, content (HTML), pinned, parentId
users/{uid}/goals/{id}             # title, description, milestones[], archived
users/{uid}/habits/{id}            # title, log{ YYYY-MM-DD: true }
users/{uid}/pomodoro/{id}          # minutes, date
users/{uid}/reminders/{id}         # title, date, time, done
users/{uid}/shifts/{id}            # shift tracker entries
users/{uid}/savingsGoals/{id}      # savings goals
users/{uid}/mandalas/{id}          # title, center{cell}, directions[8]{cell, actions[8]{cell}}
                                    #   cell = text, done, deadline, note, milestones[{id,text,done,deadline}]
```

Auth data lives in top-level, server-only collections (Admin SDK only, client access denied):

```
users_auth/{uid}            # email, emailVerified, passwordHash (argon2id) | legacyPassword, status
auth_emails/{hash}          # email uniqueness index → uid
auth_accounts/{provider:sub}# linked Google accounts
sessions/{sha256(token)}    # device, ipPrefix, idle/absolute expiry
otp_codes/{id}              # HMAC of the code, attempts, expiresAt
auth_throttle/{key}         # failures, lockout level
security_events/{auto}      # security journal (no secrets)
```

Only hashes are stored: session tokens as SHA-256, codes as HMAC with a server pepper, passwords
as argon2id, IP addresses as a prefix. Expired records are removed by Firestore TTL policies.

## Security

The rules live in the repo and **must be deployed** — they are not applied automatically:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

- `firestore.rules` — each user can read/write only `users/{their uid}`; module data requires a
  verified email (custom-token claim `bb_ev`); only the known collections are allowed; server
  collections are `if false` for clients. When adding a module/collection, add its name to
  `isKnownCollection` **and** to `USER_COLLECTIONS` in `src/firebase/account.js`.
- `storage.rules` — only `avatars/{uid}`, owner-only, images under 2 MB.
- Auth API — Origin check (CSRF) on every mutating request, `SameSite=Lax` + `__Host-` cookies,
  constant-time comparisons, single-use codes, no secrets in logs.
- `vercel.json` — security headers (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy, COOP). If you add a new external host, add it to the CSP or it will be blocked.
- Logout clears the Firestore offline cache.

Threat model and OWASP ASVS review: [docs/security-review.md](docs/security-review.md).

## Project structure

```
api/auth/[...route].ts   single Vercel Function — routes every /api/auth/* request
server/                  auth server (TypeScript strict): env, router, routes/, auth/ (sessions,
                         passwords, codes, OAuth, throttle, events, mailer)
scripts/                 migrate-users.ts — Firebase Auth → own auth import (dry run by default)
tests/
  unit/                  Vitest unit tests
  emulator/              rules + API flows on the Firebase emulators
docs/                    architecture, security review, API contract, ADR, runbooks
public/                  logo.svg, icons/, offline.html
src/
  auth/                  client for /api/auth
  components/            auth/ onboarding/ layout/ modules/ settings/ ui/  + Offline.jsx
  context/               AuthContext, ThemeContext, LangContext
  data/                  translations.js (EN / KG / RU)
  hooks/                 useCollection, useDoc, useOnlineStatus, useLocalStorage, usePWAInstall, useMediaQuery
  firebase/              config.js, account.js
  styles/                variables.css, global.css, modules.css
  App.jsx, main.jsx
```

## Deploy

Optimised for **Vercel** (static front-end + one Serverless Function). Set the environment
variables in Project → Settings → Environment Variables (secrets as **Sensitive**), deploy the
Firestore/Storage rules and indexes, and enable the Firestore TTL policies. The full ordered
checklist, including user migration and rollback, is in
[docs/deploy-checklist.md](docs/deploy-checklist.md) (in Russian); user import:
[docs/migration-runbook.md](docs/migration-runbook.md).

## License

MIT
