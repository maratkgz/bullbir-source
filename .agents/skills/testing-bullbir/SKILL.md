---
name: testing-bullbir
description: End-to-end test the BullBir productivity PWA (React + Firebase). Use when verifying auth, modules (Tasks/Finance/Mood/Journal/etc.), i18n, theme, or Firestore persistence.
---

# Testing BullBir

BullBir is a React 18 + Vite + Firebase PWA. Auth (email/phone/Google/Apple) + Firestore per-user
collections (`users/{uid}/{tasks|journals|events|transactions|moods|notes|goals|habits|pomodoro|reminders}`).

## Setup
- Keys live in gitignored `.env.local` (copy from `.env.local.example`). The app boots with placeholder
  config even without keys (auth screens render), but live data needs real `VITE_FIREBASE_*` keys.
- `npm install && npm run dev` → `http://localhost:5173`. `localhost` is an authorized Firebase domain,
  so OAuth + Firestore work locally.

## Devin Secrets Needed
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
  (User pastes the Firebase web config; write the 6 values into `.env.local`.)

## The email-verification blocker (important)
Email/password registration sends a verification link to an inbox you can't read, and the app gates
onboarding/modules behind `isVerified` (`src/context/AuthContext.jsx`). To reach the modules without
an inbox:
- Preferred: temporarily relax the gate behind a local-only env flag, e.g. add
  `|| import.meta.env.VITE_TEST_BYPASS_VERIFY === '1'` to the `isVerified` expression and put
  `VITE_TEST_BYPASS_VERIFY=1` in `.env.local`. **Revert the source edit after testing** (keep flag in
  gitignored env only); confirm `git diff` is clean.
- Alternative (if Google provider is enabled): Google sign-in popup yields `emailVerified=true`.
- The real "Verification email sent" toast on `/register` proves the send path works even with the bypass on.

## Probing the backend fast (no UI)
Use the Firebase REST API with the web `apiKey` to confirm backend setup before driving the UI:
- Email/Password enabled? `POST identitytoolkit.googleapis.com/v1/accounts:signUp?key=KEY` → returns idToken.
- Firestore works? `PATCH/GET firestore.googleapis.com/v1/projects/<projectId>/databases/(default)/documents/users/<uid>`
  with `Authorization: Bearer <idToken>`.
- Authorized domains + a possible live deploy: `GET identitytoolkit.googleapis.com/v1/projects?key=KEY`
  (look for a `*.vercel.app` etc. in `authorizedDomains`).

## Security check worth doing
Sign up a fresh user, then try writing to a `users/{otherId}` doc with their token. If it succeeds,
Firestore rules are too open — flag it. (Per-user rules are suggested in the README.)

## Golden-path UI flow to verify
1. Register (EN form, password chips go green) → "Verification email sent" toast.
2. Onboarding: language → theme (pick Dark to make it visible) → first task → "Start using BullBir".
3. Tasks: add task with High priority, **reload** → card + badge persist (proves Firestore round-trip).
4. Finance: add income then expense → assert exact balance math (e.g. 1000−250=750) + charts render.
   Gotcha: switching Expense/Income tab re-renders the modal and clears the amount — type the amount
   AFTER selecting the tab, and re-check it registered before saving.
5. Mood: pick emoji + note, Save → "Checked in for today", streak increments.
6. Journal: type in the Tiptap editor, wait ~1s → "Saved" toast, reload → text persists.
7. Theme toggle + language toggle (navbar) → instant, no reload. KG must show real Unicode ң/ү/ө
   (e.g. Күндөлүк, Жүрүм-турум, 7сөз) — not Latin/substituted chars.
8. Dashboard reflects all of the above (task count, mood emoji, balance).

## Recording tips
- Maximize the window first (`wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`).
- Annotate each test with test_start + a consolidated assertion. Mark the verify-gate as `untested`
  when bypassed, to stay honest.
