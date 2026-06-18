---
name: Trial OTP handshake
description: How the parent-to-teacher OTP handshake works for the shadow teacher trial day flow.
---

## Rule
- `trialStartOtp` is generated at `verify-trial-payment` (when payment verified → `trial_pending`).
- `trialEndOtp` is generated at `verify-trial-start-otp` (when teacher enters start OTP → `trial_started`).
- Parent SEES the OTP in their widget (`my-request` returns all match columns including OTPs).
- Teacher ENTERS the OTP in their dashboard (no OTP visible on teacher side).
- `generateOtp()` is a shared util in `artifacts/api-server/src/lib/otp.ts` — imported by both `sessions.ts` and `shadowTeacher.ts`.

## State machine
`shortlisted → trial_pending → trial_started → trial_done → committed / cancelled`

## OTP visibility (parent widget)
- `trial_pending`: show `match.trialStartOtp` (large monospace card)
- `trial_started`: show `match.trialEndOtp` (large monospace card)
- `trial_done` and beyond: no OTP shown

## Fallback path
`mark-trial-done` accepts both `trial_pending` AND `trial_started` — parent can bypass OTP if teacher can't enter it.

**Why:** Physical in-person handshake verification; teacher confirms presence without relying on push notifications.

**How to apply:** Any new lifecycle OTP should follow the same pattern — generate at prior state's completion, store on the match/engagement row, expose to the party who SHOWS it (not the party who enters it).
