---
name: Shadow match redesign pattern
description: How the new shadow-teacher matching flow works end-to-end; key decisions and gotchas for future work.
---

## The new flow (no upfront fee)
1. Parent selects a child profile → POST /shadow-teacher/request { childId }
2. API auto-scores verified shadow teachers (6 criteria, see shadowTeacherScoring.ts) and inserts up to 3 in shadow_match_candidates → status becomes "shortlisted"
3. Parent chats with candidates via GET/POST /shadow-teacher/:matchId/thread/:candidateId — messages are masked (phone/email/address redacted) until committed
4. Parent picks a teacher → POST /shadow-teacher/:matchId/commit { selectedProfessionalId } → Razorpay order for first month's fee → status "pending_commitment"
5. HMAC verify → POST /shadow-teacher/:matchId/verify-commitment → creates engagement, status "committed", full contact revealed

## Key decisions
- **Why no upfront matching fee?** Removes friction; teachers are Indian indie professionals who need direct trust-building first.
- **Contact masking**: maskBody() in shadowTeacherScoring.ts strips phone/email/UPI from message bodies using regex. Candidate profiles suppress fullName/phone/email until committed.
- **Teacher pricing gate**: commit returns HTTP 409 commitment_blocked_no_pricing if teacher.pricingMinINR is null — admin must agree fee with teacher first.
- **useGetMe() for DB user ID**: ShadowTeacherRequestWidget uses useGetMe() from @workspace/api-client-react (not Clerk publicMetadata) to get the DB user id for chat alignment.

## Schema delta (migration 0014)
- shadow_match_status enum: +pending, +shortlisted, +pending_commitment, +committed
- shadow_teacher_matches: +14 columns (child snapshot: child_id, child_city, child_conditions[], child_languages[], child_budget_min_inr, child_budget_max_inr, child_goals_areas[], child_preferred_modes[], extra_notes; commit: selected_professional_id, matched_professional_id; admin: admin_notes, cancelled_at, refunded_at)
- professional_profiles: +languages text[]
- New tables: shadow_match_candidates, shadow_match_threads, shadow_match_messages

## How to apply
Run `lib/db/migrations/0014_shadow_match_redesign.sql` directly against the DB (all statements use IF NOT EXISTS). Do NOT use drizzle-kit push without user approval — it asks interactive rename-or-create questions even with --force.
