-- 0019_trial_otp
-- Adds the trial_started intermediate state and the two OTP columns needed
-- for the parent-to-teacher OTP handshake during the trial day.

ALTER TYPE shadow_match_status ADD VALUE IF NOT EXISTS 'trial_started' AFTER 'trial_pending';

ALTER TABLE shadow_teacher_matches
  ADD COLUMN IF NOT EXISTS trial_start_otp VARCHAR(6),
  ADD COLUMN IF NOT EXISTS trial_end_otp   VARCHAR(6);
