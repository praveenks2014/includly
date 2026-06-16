-- ═══════════════════════════════════════════════════════════════════════
-- 0018_trial_phase: trial session support + salary credit carry-over
-- Apply: psql $DATABASE_URL -f lib/db/migrations/0018_trial_phase.sql
--
-- IMPORTANT: ALTER TYPE ADD VALUE cannot run inside an explicit
-- transaction block. psql -f runs in auto-commit mode (each statement
-- is its own implicit transaction). Do NOT wrap this file in
-- BEGIN/COMMIT in any migration runner.
-- AFTER clause is deliberately omitted — enum ordering is unused
-- in equality comparisons; removing it eliminates inter-statement
-- dependency so either value can commit independently.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Step 1: Enum additions (each auto-committed independently in psql) ──
ALTER TYPE shadow_match_status ADD VALUE IF NOT EXISTS 'trial_pending';
ALTER TYPE shadow_match_status ADD VALUE IF NOT EXISTS 'trial_done';

-- ── Step 2: Table DDL — safe in any transaction context ─────────────────

-- trial_fee_paid_inr: amount parent paid for the trial session
-- pre_meeting_requested / note: optional pre-engagement meeting request
ALTER TABLE shadow_teacher_matches
  ADD COLUMN IF NOT EXISTS trial_fee_paid_inr    INTEGER,
  ADD COLUMN IF NOT EXISTS pre_meeting_requested  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pre_meeting_note       TEXT;

-- trial_credit_inr: auto-carried from match.trial_fee_paid_inr at engagement creation
-- trial_credit_applied: flips true when the credit is consumed at verify-salary-payment
ALTER TABLE shadow_teacher_engagements
  ADD COLUMN IF NOT EXISTS trial_credit_inr      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_credit_applied   BOOLEAN NOT NULL DEFAULT FALSE;

-- trial_credit_inr on each salary payment row: pins the credit amount
-- at order creation so retries reuse the same value (prevents double-apply)
ALTER TABLE engagement_salary_payments
  ADD COLUMN IF NOT EXISTS trial_credit_inr      INTEGER NOT NULL DEFAULT 0;
