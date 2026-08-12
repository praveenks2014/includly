---
name: Notification timing — await vs void
description: createInAppNotification must be awaited (not fire-and-forget) when the response immediately follows and test/verification code queries the DB for the notification.
---

## Rule
Use `await createInAppNotification(...)` in route handlers where the response is sent on the same code path right after. Never use `void createInAppNotification(...).catch(() => {})` unless you explicitly accept that the notification may not exist by the time the HTTP response arrives.

## Why
`void promise.catch(() => {})` discards the result and lets the insert run concurrently. When the HTTP response reaches the caller and the caller immediately queries the DB, the notification row may not be committed yet — producing intermittent test failures and incorrect real-time notifications. Awaiting costs one DB round-trip of latency on error paths (403/4xx), which is acceptable.

## How to apply
- In `therapyBookings.ts` (and any future OTP lockout handler): `await createInAppNotification(...)` before the `res.status(4xx).json(...)` line.
- In happy-path handlers where notifications are truly supplementary and low-latency matters more, `void` is acceptable — but document it.
