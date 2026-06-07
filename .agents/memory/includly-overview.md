---
name: Includly project overview
description: Indian special-needs marketplace — key architectural decisions, auth quirks, and session OTP flow design.
---

## Auth
- Production Clerk custom domain: `clerk.includly.in` — JWKS at `https://clerk.includly.in/.well-known/jwks.json`
- `requireAuth` explicitly trusts both `clerk.includly.in` (prod) and `choice-lion-57.clerk.accounts.dev` (dev)
- `fetchWithAuth` in `@/lib/api.ts` returns raw `Promise<Response>` — always chain `.then(r => r.json())` and prefix paths with `/api/`
- Admin email: `praveenece.mit@gmail.com` — seeded admin in both Clerk instances on every server boot

## Session OTP Flow
- Confirmed bookings get `start_otp` + `end_otp` (6-digit strings) generated at booking time
- Parent sees codes in their SessionCard (teal panel) — shows both codes to the specialist
- Specialist enters start OTP → `POST /sessions/:id/verify-start-otp` → sets `startedAt`
- Specialist enters end OTP → `POST /sessions/:id/verify-end-otp` → sets status=completed + releases escrow
- Sessions GET: professional view returns `startedAt`; parent view returns `startOtp` + `endOtp`

## Chat (Connect)
- Connect threads: parent ↔ professional, gated by `contact_unlocks` (parent must have unlocked the professional)
- Routes: `GET /connect/:professionalId/thread` (parent), `POST /connect/:professionalId/messages` (parent)
- Thread-based routes (both parties): `GET|POST /connect/thread/:threadId/messages`
- Professional inbox: `GET /connect/inbox` — returns threads with parentName
- Frontend: parent opens chat from UnlocksTab via ChatModal; professional uses MessagesTab (inbox → thread view)

## Design Tokens
- Primary: #2EC4A5, Accent: #FF6B6B, Navy: #1A2340, BG: #F5F7FA
- Fonts: Fraunces (headings, `font-serif`), DM Sans (body)

## Ledger / Payments
- `releaseWithCommission(ledgerEntryId: number)` — takes a numeric ledger entry ID, NOT an object
- Use `findLedgerByBooking(bookingId)` first, then pass `entry.id` to `releaseWithCommission`
- Sessions GET uses explicit column selects — adding new columns requires updating both professional and parent query blocks

## DB
- Sessions schema: `lib/db/src/schema/sessions.ts`
- OTP columns (`start_otp`, `end_otp`, `started_at`) were added via ALTER TABLE + Drizzle schema update
