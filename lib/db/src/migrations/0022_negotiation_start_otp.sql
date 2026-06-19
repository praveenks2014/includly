-- Part A: negotiation offers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'negotiation_offer_status') THEN
    CREATE TYPE negotiation_offer_status AS ENUM ('pending','accepted','superseded','withdrawn');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS negotiation_offers (
  id                  serial PRIMARY KEY,
  match_id            integer NOT NULL REFERENCES shadow_teacher_matches(id) ON DELETE CASCADE,
  candidate_id        integer NOT NULL REFERENCES shadow_match_candidates(id) ON DELETE CASCADE,
  raised_by_user_id   integer NOT NULL REFERENCES users(id),
  raised_by_role      text    NOT NULL CHECK (raised_by_role IN ('parent','professional')),
  amount_inr          integer NOT NULL,
  status              negotiation_offer_status NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Part B: pending_start status + start OTP storage
ALTER TYPE engagement_status ADD VALUE IF NOT EXISTS 'pending_start';
ALTER TABLE shadow_teacher_engagements ADD COLUMN IF NOT EXISTS start_otp text;
