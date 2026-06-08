-- Migration 0013: Booking Flow V2 (two-flow spec)
-- Flow A: Shadow Teacher matching fee
-- Flow B: Per-session escrow with full state machine

-- 1. Extend session_status enum with new values
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'requested';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'confirmed_by_pro';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'paid_held';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'session_started';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'session_completed';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'releasable';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'released';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'disputed';

-- 2. New columns on session_bookings
ALTER TABLE session_bookings
  ADD COLUMN IF NOT EXISTS otp_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS otp_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS pro_amount_inr integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS markup_inr integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_inr integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by integer;

-- 3. Add UPI VPA to professional_profiles
ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS upi_vpa text;

-- 4. Admin settings: new config fields
ALTER TABLE admin_settings
  ADD COLUMN IF NOT EXISTS matching_fee_inr integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS matching_fee_refundable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS markup_pct real NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS markup_flat_inr integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_rate_pct real NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS tcs_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tds_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS otp_validity_minutes integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS auto_cancel_hours integer NOT NULL DEFAULT 2;

-- 5. Shadow teacher match status enum + table
DO $$ BEGIN
  CREATE TYPE shadow_match_status AS ENUM (
    'pending_payment', 'payment_failed', 'queued', 'matched', 'cancelled', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS shadow_teacher_matches (
  id serial PRIMARY KEY,
  parent_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matched_professional_id integer REFERENCES professional_profiles(id) ON DELETE SET NULL,
  status shadow_match_status NOT NULL DEFAULT 'pending_payment',
  matching_fee_inr integer NOT NULL,
  provider_order_id text,
  provider_payment_id text,
  child_details text,
  requirements text,
  admin_notes text,
  matched_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Payout status enum + booking_payouts table
DO $$ BEGIN
  CREATE TYPE payout_status AS ENUM ('pending', 'released', 'failed', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS booking_payouts (
  id serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
  professional_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  pro_amount_inr integer NOT NULL,
  markup_inr integer NOT NULL DEFAULT 0,
  gst_inr integer NOT NULL DEFAULT 0,
  total_collected_inr integer NOT NULL,
  upi_vpa text,
  razorpay_payout_id text,
  status payout_status NOT NULL DEFAULT 'pending',
  note text,
  released_by integer REFERENCES users(id) ON DELETE SET NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
