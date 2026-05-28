-- Phase 4: bookable assessments
-- Run after 0001_phase3.sql

-- 1. Extend ledger booking type enum
ALTER TYPE ledger_booking_type ADD VALUE IF NOT EXISTS 'assessment';

-- 2. Add booking_type + assessment_offering_id to session_bookings
ALTER TABLE session_bookings
  ADD COLUMN IF NOT EXISTS booking_type text NOT NULL DEFAULT 'session',
  ADD COLUMN IF NOT EXISTS assessment_offering_id integer;

-- 3. Assessment offerings (what a specialist offers)
CREATE TABLE IF NOT EXISTS assessment_offerings (
  id                serial       PRIMARY KEY,
  professional_id   integer      NOT NULL REFERENCES professional_profiles(id) ON DELETE CASCADE,
  title             text         NOT NULL,
  assessment_type   text         NOT NULL,
  description       text,
  duration_minutes  integer      NOT NULL DEFAULT 60,
  price_inr         integer      NOT NULL,
  what_is_included  text,
  is_active         boolean      NOT NULL DEFAULT true,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_offerings_professional_id_idx
  ON assessment_offerings(professional_id);

-- 4. Assessment reports (attached to child profile)
CREATE TABLE IF NOT EXISTS assessment_reports (
  id                serial       PRIMARY KEY,
  booking_id        integer      NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
  child_id          integer      REFERENCES children(id) ON DELETE SET NULL,
  professional_id   integer      NOT NULL REFERENCES professional_profiles(id) ON DELETE CASCADE,
  parent_id         integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_type       text         NOT NULL DEFAULT 'assessment',
  summary           text,
  observation_notes text,
  recommendations   text,
  diagnosis_tags    text[]       NOT NULL DEFAULT '{}',
  report_file_key   text,
  template_data     text,
  status            text         NOT NULL DEFAULT 'draft',
  submitted_at      timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assessment_reports_child_id_idx    ON assessment_reports(child_id);
CREATE INDEX IF NOT EXISTS assessment_reports_booking_id_idx  ON assessment_reports(booking_id);
