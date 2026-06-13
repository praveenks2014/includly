-- ============================================================================
-- Migration 0016 — Shadow-Teacher Deposit-at-Request Model
--
-- Adds two columns to shadow_teacher_matches for the deposit-at-request flow:
--   fee_paid_at            — timestamp when Razorpay payment was verified
--                            (drives the 60-day refund-eligibility window)
--   distinct_teachers_shown — high-water-mark counter of unique teachers ever
--                             surfaced for this request; increments on each new
--                             teacher shown, never decrements; drives refund gate
--
-- Additive only — no columns dropped, no existing constraints changed.
-- Safe to re-run (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE shadow_teacher_matches
  ADD COLUMN IF NOT EXISTS fee_paid_at              timestamptz,
  ADD COLUMN IF NOT EXISTS distinct_teachers_shown  integer NOT NULL DEFAULT 0;
