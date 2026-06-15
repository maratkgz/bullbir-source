# BullBir

All-in-one personal productivity web app (a premium alternative to Notion) — built as an installable **PWA**.

One space for your life, work, and self-development: tasks, journal, calendar, finance, mood, notes, goals & habits, pomodoro, and reminders. Fully trilingual (English / Kyrgyz / Русский), with light & dark themes, fluid Framer Motion animations, and offline support.

## Stack

- **React 18** + **Vite**
- **CSS Custom Properties** (no UI kit, no Tailwind, no Bootstrap)
- **Framer Motion** — all animation
- **Firebase** — Auth + Firestore (with offline persistence) + Storage
- **vite-plugin-pwa** — manifest, service worker, install prompt
- **@dnd-kit** — Kanban drag & drop
- **Tiptap** — rich text (Journal & Notes)
- **Recharts** — Finance & Mood charts
- **date-fns** — date logic
- **idb-keyval** — offline cache helper

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure Firebase
cp .env.local.example .env.local
# then fill in your VITE_FIREBASE_* values

# 3. Run the dev server
npm run dev

# 4. Production build / preview
npm run build
npm run preview
```

The app runs without Firebase keys (you'll see the auth screens), but live auth and
data require a real Firebase project. Enable **Email/Password**, **Phone**, **Google**,
and **Apple** sign-in providers in the Firebase console, and create a **Firestore** database.

## Environment variables

| Variable | Description |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Auth domain (`<project>.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Messaging sender ID |
| `VITE_FIREBASE_APP_ID` | App ID |

## Data model

All user data lives under `users/{uid}`:

```
users/{uid}                         # profile, onboardingDone, language, theme
users/{uid}/tasks/{id}              # title, description, status, priority, tags[], deadline, subtasks[]
users/{uid}/journals/{YYYY-MM-DD}   # content (HTML), mood, private
users/{uid}/events/{id}            # title, date, time, allDay, category, color
users/{uid}/transactions/{id}      # type, amount, category, note, date, currency
users/{uid}/moods/{YYYY-MM-DD}     # value (0-4), note
users/{uid}/notes/{id}             # title, content (HTML), pinned, parentId
users/{uid}/goals/{id}             # title, description, milestones[], archived
users/{uid}/habits/{id}            # title, log{ YYYY-MM-DD: true }
users/{uid}/pomodoro/{id}          # minutes, date
users/{uid}/reminders/{id}         # title, date, time, done
```

### Suggested Firestore security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Project structure

```
public/            logo.svg (single source logo), icons/, offline.html
src/
  components/      auth/ onboarding/ layout/ modules/ settings/ ui/  + Offline.jsx
  context/         AuthContext, ThemeContext, LangContext
  data/            translations.js (EN / KG / RU)
  hooks/           useCollection, useDoc, useOnlineStatus, useLocalStorage, usePWAInstall, useMediaQuery
  firebase/        config.js
  styles/          variables.css, global.css, modules.css
  utils/           format.js
  App.jsx, main.jsx
```

## Deploy

Optimised for **Vercel**. Connect the repo, set the `VITE_FIREBASE_*` environment
variables in the project settings, and deploy — the included `vercel.json` keeps
client-side routing working.

## License

MIT
