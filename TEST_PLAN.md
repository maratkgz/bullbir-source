# BullBir — E2E Test Plan (PR #1)

Tested locally at `http://localhost:5173` against the **real** `bullbir` Firebase project
(`.env.local` has live keys; localhost is an authorized domain).

**Disclosure:** Email verification requires clicking a link in an inbox I cannot access.
For the module flow I temporarily relax the `isVerified` gate in `src/context/AuthContext.jsx:151`
(set to `!!user`) so a freshly-registered email/password account can reach onboarding + modules.
The patch is reverted before finishing. The real verification screen + email-send is tested separately (Test 1).

## Test 1 — Registration + email verification gate (no patch yet)
Steps: Go to `/register`, fill name/email/password, submit.
- PASS if: app navigates to the verify-email screen showing the typed email, and a toast/screen
  indicates a verification email was sent. (Broken would: error out or land on dashboard without verify.)
- Also assert `/app/dashboard` is NOT reachable while unverified (guard redirects to `/verify-email`).

## Test 2 — Onboarding writes to Firestore (patch applied, logged in)
Steps: Log in with the account; complete onboarding (pick language, theme, type a first task).
- PASS if: onboarding completes to Dashboard, AND `users/{uid}.onboardingDone == true` in Firestore,
  AND the typed first task appears later in the Tasks module (proves write to `users/{uid}/tasks`).

## Test 3 — Tasks (create + persist + reload)
Steps: On Tasks, add a task "Buy milk" priority High; reload the page.
- PASS if: task card "Buy milk" persists after reload with a High-priority badge (proves Firestore round-trip,
  not just local state). Broken would: card disappears on reload.

## Test 4 — Finance (transaction + chart + balance math)
Steps: Add an expense 250 and an income 1000.
- PASS if: Balance stat = income − expense = **750** (exact), transaction list shows both rows with
  +1000 / −250, and the pie/line chart renders at least one segment. Broken would: wrong balance or empty chart.

## Test 5 — Mood check-in (streak + persist)
Steps: Pick a mood emoji, optional note, Save.
- PASS if: UI switches to the "checked-in" state showing the chosen emoji, streak shows "1",
  and reload keeps the checked-in state for today.

## Test 6 — Journal autosave (real doc)
Steps: Navigate to today's Journal, type text in the editor, wait ~1s for autosave toast.
- PASS if: "Saved" toast fires, reload shows the same text (proves `useDoc` write to `users/{uid}/journals/{YYYY-MM-DD}`).

## Test 7 — Theme + language toggle (no reload)
Steps: From the navbar toggle theme light→dark, then switch language EN→KG.
- PASS if: `data-theme` flips to `dark` and colors change instantly (no reload), and KG strings render
  with correct ң/ү/ө (e.g. nav/labels). Broken would: reload flash or Latin transliteration.

## Test 8 — Dashboard reflects real data (regression-ish, quick)
Steps: Return to Dashboard.
- PASS if: widgets reflect data created above (e.g. tasks count ≥1, balance 750, today's mood emoji).

## Cleanup
- Revert `AuthContext.jsx:151` to the original `isVerified` expression; confirm `git diff` is empty.
</content>
