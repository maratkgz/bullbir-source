# BullBir — E2E Test Report (PR #1)

**How tested:** Ran the app locally (`localhost:5173`, which is an authorized Firebase domain) against the **real** `bullbir` Firebase project using the keys you provided. Drove the full UI with a screen recording: register → onboarding → Tasks → Finance → Mood → Journal → theme/language → Dashboard.

**Result:** 8/8 functional tests passed. Two things to flag (below).

---

## ⚠️ Flags (read first)

1. **Email-verification gate was bypassed for the module run.** The app requires a verified email before reaching onboarding/modules, and email verification needs a link clicked in an inbox I can't access. To exercise the 10 modules I temporarily relaxed the `isVerified` check behind a local env flag (`VITE_TEST_BYPASS_VERIFY`, only in gitignored `.env.local`) and **reverted it after testing** (`git diff` is clean). The real registration + "Verification email sent" path *was* tested (Test 1). The hard redirect-to-verify gate itself was not demonstrated on camera.

2. **Firestore security rules look wide open.** Using a freshly-created user's token I was able to write to `users/1000` — a document that does **not** belong to that user — and it succeeded. That means any authenticated user can read/write other users' data. Before real users sign up, lock the rules down to per-user access (the README has a suggested ruleset). This is a backend/config issue, not a code bug in the PR.

---

## Test results

| # | Test | Result |
|---|------|--------|
| 1 | Register → "Verification email sent" toast | PASS |
| 1b | Hard verify-gate shown on camera | UNTESTED (bypassed) |
| 2 | Onboarding persists (dark theme + first task) → Dashboard | PASS |
| 3 | Tasks: create "Buy milk" (High), persists across reload | PASS |
| 4 | Finance: income 1000 − expense 250 = balance **750**, charts render | PASS |
| 5 | Mood: check-in 😄 + note, streak 0→1 | PASS |
| 6 | Journal: autosave toast, text persists across reload | PASS |
| 7 | Theme + language toggle instant (no reload), correct ң/ү/ө | PASS |
| 8 | Dashboard reflects live data (tasks 2, mood 😄, balance 750) | PASS |

---

## Evidence

### Test 1 — Registration (real Firebase)
Form validates password rules; on submit a "Verification email sent" toast fires and Firebase creates the account.

![register](screens/01-register.png)

### Test 3 — Tasks persist across reload
"Buy milk" (red **High** badge) survives a full page reload → confirms Firestore round-trip, not local state.

![tasks](screens/03-tasks.png)

### Test 4 — Finance balance math
Income 1,000 − Expense 250 = **Balance 750**; pie ("By category") + line ("Over time") charts render.

![finance](screens/04-finance.png)

### Test 5 — Mood check-in
Switches to "Checked in for today" with 😄 and note; **streak goes 0 → 1**; area chart plots the point.

![mood](screens/05-mood.png)

### Test 6 — Journal autosave
"Saved" toast fires; entry text and 7-word count persist after reload.

![journal](screens/06-journal.png)

### Test 7 — Light theme + Kyrgyz (correct Unicode)
Theme and language switch instantly (no reload). KG renders proper ң/ү/ө: **Күндөлүк**, **Жүрүм-турум**, **7сөз**.

![kg](screens/07-kg.png)

### Test 8 — Dashboard reflects live data
Tasks **2** (Buy milk, Plan my week), Mood 😄, Balance **750 с**, fully localized to KG.

![dashboard](screens/08-dashboard.png)

---

Tested by Devin — session: https://app.devin.ai/sessions/a228113263ce475c865a3778cc8805c4
</content>
