# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install deps
npm run dev           # start Vite dev server at http://localhost:5173
npm run build         # production build
npm run preview       # preview the production build
npm run lint           # eslint .
```

There is no test runner configured (no unit/e2e test framework in `package.json`). `TEST_PLAN.md` /
`test-report.md` are manual QA notes from prior sessions, not automated suites. When asked to verify
behavior, drive the app manually (dev server + browser) rather than looking for a test command.

Firebase keys go in a gitignored `.env.local` (copy from `.env.local.example`):
`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
The app boots and renders auth
screens even without keys — `firebaseReady` (`src/firebase/config.js`) gates all network calls, and
a `demo-*` fallback config is used when real keys are absent so `initializeApp` doesn't throw.

## Architecture

**Stack**: React 18 + Vite, no UI kit (hand-rolled CSS custom properties in `src/styles/`), Framer
Motion for all animation, Firebase (Auth + Firestore with offline persistence + Storage),
`vite-plugin-pwa`, `@dnd-kit` (Kanban drag & drop), Tiptap (rich text), Recharts, date-fns.

### Provider nesting (`src/main.jsx`)
`LangProvider > ThemeProvider > ToastProvider > AuthProvider > BrowserRouter > App`. Order matters:
Auth/data hooks assume Lang/Theme/Toast are already available.

### Auth & routing gate chain
Three sequential gates, each redirecting to the previous step if unmet, checked via `useAuth()`
(`src/context/AuthContext.jsx`) in `src/App.jsx` and `PrivateRoute`:
1. `user` (signed in) → else `/login`
2. `isVerified` = `emailVerified || (phoneNumber && !email)` → else `/verify-email`
3. `onboardingDone` (from the Firestore `users/{uid}` doc) → else `/onboarding`

Only after all three does `/app/*` (wrapped in `AppLayout`) render. `PublicRoute`/`VerifyRoute`/
`OnboardingRoute` in `App.jsx` do the inverse redirects for already-progressed users. Modules are
added by: creating `src/components/modules/Foo.jsx`, adding a `<Route path="foo">` under `/app` in
`App.jsx`, and adding an entry to `NAV_ITEMS` in `src/components/layout/navItems.jsx` (and to
`BOTTOM_NAV_ITEMS` if it should also appear in the mobile bottom nav, max 5 items).

### Data layer — per-user Firestore collections
All user data lives under `users/{uid}/...` (see the collection list in `README.md`). Two generic
hooks wrap Firestore and are what every module uses instead of calling `firebase/firestore` directly:
- `useCollection(name, { orderField, direction })` (`src/hooks/useCollection.js`) — real-time
  `onSnapshot` list at `users/{uid}/{name}`, returns `{ items, loading, add, update, remove }`.
  `add`/`update` stamp `createdAt`/`updatedAt` via `serverTimestamp()` automatically.
- `useDoc(name, id)` (`src/hooks/useDoc.js`) — real-time single doc at `users/{uid}/{name}/{id}`,
  returns `{ data, loading, save }` (`save` does a merge `setDoc`).

Both no-op safely when there's no signed-in user or `firebaseReady` is false. When adding a new
module's persistence, prefer these hooks over new bespoke Firestore code.

### i18n
Trilingual EN/KG/RU via `LangContext` (`src/context/LangContext.jsx`) backed by a flat key→string
dictionary per language in `src/data/translations.js`. Use `t('some.key', vars)` from `useLang()`;
`{var}` placeholders in strings are replaced from the `vars` object. `tError(err)` maps Firebase auth
error codes (`fb.<code>` keys) to localized strings. Kyrgyz strings must use real Cyrillic-extended
characters (ң, ү, ө) — not Latin substitutes. When adding user-facing text, add the key to all three
language blocks in `translations.js`, not just `en`.

### Theming
`ThemeContext` (`src/context/ThemeContext.jsx`) toggles `data-theme="dark"|"light"` on
`<html>`; all colors are CSS custom properties defined per-theme in `src/styles/variables.css`.
Persisted via `useLocalStorage`, defaults to OS `prefers-color-scheme`.

### Security
`firestore.rules` / `storage.rules` (deployed with `firebase deploy --only firestore:rules,storage`)
allow-list the per-user collections — a new collection must be added to `isKnownCollection` in
`firestore.rules` AND `USER_COLLECTIONS` in `src/firebase/account.js` (used by export + account
deletion), or writes are denied. `src/firebase/account.js` also owns logout (`signOutAndClear`
wipes the Firestore IndexedDB cache) and `deleteAccountAndData`. CSP + security headers are in
`vercel.json`; a new external host must be added to the CSP. The service worker intentionally does
not cache Firebase/Google API responses.

### Mandala (9×9)
`src/components/modules/mandala/` — one doc per chart in `users/{uid}/mandalas`. Pure data logic in
`mandalaModel.js` (immutable updates, input caps); `MandalaGrid` renders 9 blocks, `RING_POSITIONS`
maps direction/action index → clockwise position in a 3×3 block.

### Icons
All UI icons are Lucide via `src/components/ui/Icon.jsx` (`<Icon icon={Plus} />`, default size 20,
stroke 1.75, `currentColor`, decorative unless `label` is passed; `size="1em"` to match surrounding
text). Import icons one by one from `lucide-react` — never the whole package. Module icons live in
`src/config/moduleIcons.js` (nav, landing). Icon-only buttons need an `aria-label`. User-chosen emoji
(goal/habit/savings pickers) and mood-scale faces stay emoji on purpose: they are stored user data.

### Local persistence
`useLocalStorage` (`src/hooks/useLocalStorage.js`) is the generic localStorage-backed `useState`
used for language/theme and other client-only preferences (not Firestore data).

### PWA / offline
`vite-plugin-pwa` (config in `vite.config.js`) generates the manifest and service worker
(`registerType: 'autoUpdate'`, registered in `main.jsx` via `registerSW`). Firebase/Google API calls
use `NetworkFirst`; static assets (`style`, `script`, `worker`, `font`) use `CacheFirst`.
`useOnlineStatus` (`src/hooks/useOnlineStatus.js`) drives the offline banner (`src/components/
Offline.jsx`) shown by `App.jsx` when the browser goes offline; `public/offline.html` is the
navigation fallback when fully offline with no cached shell.
