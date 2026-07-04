---
name: Testing skill Clerk-auth block persists for the whole session
description: Once runTest() hits a Clerk auth blockage, ALL subsequent runTest calls in the same conversation report the same cached block, even unrelated ones.
---

If a `runTest()` call tries to sign in via Clerk's real UI with an email Clerk doesn't recognize (e.g. omitting `testClerkAuth: true`, or using a stale/real-looking email), it can trip an "OAuth blockage" that gets treated as blocking further testing. From that point on, **every subsequent `runTest()` call in the same session reports the identical cached "Testing is blocked" error** — even a trivial test plan with no Clerk auth step at all (verified: a plain homepage-navigation test with zero login steps still returned the exact same cached blockage message).

**Why:** The block appears to live in the testing subagent's session state, not in the local `code_execution` notebook — restarting the notebook (`restart: true`) does NOT clear it.

**How to apply:**
- Always pass `testClerkAuth: true` to `runTest()` when the test plan includes a `[Clerk Auth]` step (per `clerk-auth.md`), and describe *who* to sign in as (name/email) rather than scripting interaction with Clerk's real sign-in UI.
- Never reuse a real-looking/pre-existing user's email for programmatic Clerk test auth — use fresh synthetic emails.
- If a `runTest()` call ever reports a Clerk/OAuth "blocked" status, do not keep retrying `runTest()` in that same session (it will not recover). Pivot immediately to alternate verification: typecheck, direct code review of the exact JSX/logic, backend curl checks, `screenshot` tool (app_preview, unauthenticated pages only), and workflow log review — and say so explicitly when reporting results to the user.
