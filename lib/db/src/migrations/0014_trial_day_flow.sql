-- Migration 0014: Trial day flow for shadow teacher matches
-- Adds trial_fee_inr to admin_settings (admin-configurable, default ₹500).
-- Adds trial_provider_order_id and trial_provider_payment_id to shadow_teacher_matches
-- for Razorpay payment tracking on the optional trial fee.
--
-- Note: shadow_match_status enum values (trial_pending, trial_done) and
--       shadow_teacher_matches columns (trial_fee_paid_inr, pre_meeting_requested,
--       pre_meeting_note) were already applied directly to the DB prior to this migration.

ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS trial_fee_inr integer NOT NULL DEFAULT 500;

ALTER TABLE shadow_teacher_matches
  ADD COLUMN IF NOT EXISTS trial_provider_order_id text,
  ADD COLUMN IF NOT EXISTS trial_provider_payment_id text;
