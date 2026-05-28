-- Phase 3 migration: children, notes, intake, ledger, connect threads,
-- shadow teacher engagements, wallet, commission rates, and additive column additions.

-- ── Enum types ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE ledger_status AS ENUM ('held', 'released', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_booking_type AS ENUM ('session', 'package', 'subscription', 'engagement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE engagement_status AS ENUM ('active', 'paused', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wallet_tx_type AS ENUM ('credit', 'debit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE wallet_source_type AS ENUM ('refund', 'topup', 'booking', 'engagement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── New columns on existing tables ────────────────────────────────────────────
ALTER TABLE contact_unlocks
  ADD COLUMN IF NOT EXISTS chat_access_only boolean NOT NULL DEFAULT false;

ALTER TABLE session_bookings
  ADD COLUMN IF NOT EXISTS child_id integer;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wallet_balance_inr integer NOT NULL DEFAULT 0;

-- ── New tables ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS children (
  id             serial PRIMARY KEY,
  parent_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  dob            text,
  diagnosis_tags text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_notes (
  id               serial PRIMARY KEY,
  booking_id       integer NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
  author_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  private_notes    text,
  parent_summary   text,
  progress_markers text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intake_forms (
  id              serial PRIMARY KEY,
  booking_id      integer NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
  parent_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goals           text,
  concerns        text,
  additional_info text,
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_ledger (
  id                   serial PRIMARY KEY,
  booking_id           integer,
  engagement_id        integer,
  parent_id            integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  amount_inr           integer NOT NULL,
  commission_inr       integer NOT NULL DEFAULT 0,
  commission_pct       integer NOT NULL DEFAULT 0,
  booking_type         ledger_booking_type NOT NULL DEFAULT 'session',
  status               ledger_status NOT NULL DEFAULT 'held',
  note                 text,
  held_at              timestamptz NOT NULL DEFAULT now(),
  released_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connect_threads (
  id              serial PRIMARY KEY,
  parent_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id integer NOT NULL REFERENCES professional_profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connect_messages (
  id         serial PRIMARY KEY,
  thread_id  integer NOT NULL REFERENCES connect_threads(id) ON DELETE CASCADE,
  sender_id  integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connect_messages_thread_id_created_at_idx
  ON connect_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS shadow_teacher_engagements (
  id                  serial PRIMARY KEY,
  parent_id           integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  professional_id     integer NOT NULL REFERENCES professional_profiles(id) ON DELETE CASCADE,
  child_id            integer,
  start_date          text NOT NULL,
  hours_per_week      integer NOT NULL,
  monthly_fee_inr     integer NOT NULL,
  status              engagement_status NOT NULL DEFAULT 'active',
  next_billing_date   text,
  billed_through_date text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_logs (
  id                 serial PRIMARY KEY,
  engagement_id      integer NOT NULL REFERENCES shadow_teacher_engagements(id) ON DELETE CASCADE,
  week_start_date    text NOT NULL,
  hours_logged       integer NOT NULL,
  notes              text,
  logged_by_user_id  integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            serial PRIMARY KEY,
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_inr    integer NOT NULL,
  type          wallet_tx_type NOT NULL,
  source_type   wallet_source_type NOT NULL,
  reference_id  integer,
  description   text,
  balance_after integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commission_rates (
  id           serial PRIMARY KEY,
  booking_type text NOT NULL UNIQUE,
  rate_pct     integer NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Seed default commission rates ─────────────────────────────────────────────
INSERT INTO commission_rates (booking_type, rate_pct, notes)
VALUES
  ('session',     10, 'Single session booking — highest rate'),
  ('package',      7, 'Session pass / credit package — lower rate'),
  ('subscription', 5, 'Monthly subscription / recurring plan — lowest rate'),
  ('engagement',   5, 'Shadow-teacher monthly engagement — lowest rate')
ON CONFLICT (booking_type) DO NOTHING;
