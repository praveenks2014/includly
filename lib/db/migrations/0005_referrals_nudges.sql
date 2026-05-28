-- Phase 7: Referrals + retention nudges

-- Referral columns on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_winback_nudge_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_low_credit_nudge_at timestamptz;

-- Session reminder dedup flag
ALTER TABLE session_bookings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Notification preference columns for new nudge types
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS on_session_reminder boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS on_low_credits boolean NOT NULL DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS on_community_reply boolean NOT NULL DEFAULT true;

-- Referral status enum
DO $$ BEGIN
  CREATE TYPE referral_status AS ENUM ('pending', 'converted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id serial PRIMARY KEY,
  referrer_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status referral_status NOT NULL DEFAULT 'pending',
  reward_inr integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS referrals_referred_idx ON referrals (referred_user_id);
