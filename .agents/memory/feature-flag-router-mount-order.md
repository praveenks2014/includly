---
name: Feature-flag router mount order
description: Routers with a global router.use() gate (therapist.ts, tutor.ts) block ALL requests unless therapy-bookings and similar routers are mounted before them.
---

## Rule
Any route that must be reachable regardless of the `SHOW_THERAPIST_SEARCH` / `SHOW_TUTOR_SEARCH` feature flags must be mounted in `routes/index.ts` **before** `therapistRouter` and `tutorRouter`.

## Why
`therapist.ts` and `tutor.ts` each open with `router.use((_req, res, next) => { if (!FLAG) { res.status(404).json({error:"Not found"}); return; } next(); })`. Express sub-routers with an unconditional `router.use()` intercept **every** request that enters them — including ones with no matching route — and can send a response before the parent router tries the next sub-router. This caused all `POST /api/therapy-bookings/:id/start-otp` requests to return 404 when the flag was false, even though `therapyBookingsRouter` was mounted after and had the correct routes.

## How to apply
When adding a new router that must always be reachable:
- Mount it before `tutorRouter` and `therapistRouter` in `routes/index.ts`.
- The comment block at the top of `routes/index.ts` explains the pattern; follow it.
- The same caution applies to `behaviorLogsRouter` which uses `router.use(requireAuth)` + `router.use(requireRole("parent"))` globally.
