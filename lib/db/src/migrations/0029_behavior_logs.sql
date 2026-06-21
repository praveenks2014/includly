-- Migration 0029: behavior_logs table
-- Parent-private behavior / tantrum incident tracking.
-- Additive only — no existing tables or columns modified.

CREATE TABLE IF NOT EXISTS behavior_logs (
  id                SERIAL PRIMARY KEY,
  child_id          INTEGER      NOT NULL REFERENCES children(id)                    ON DELETE CASCADE,
  engagement_id     INTEGER               REFERENCES shadow_teacher_engagements(id)  ON DELETE SET NULL,
  daily_log_id      INTEGER               REFERENCES engagement_daily_logs(id)       ON DELETE SET NULL,
  logged_by         INTEGER      NOT NULL REFERENCES users(id),
  occurred_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  tantrum_types     TEXT[]       NOT NULL,
  triggers          TEXT[],
  duration_minutes  INTEGER,
  intensity         TEXT         NOT NULL CHECK (intensity IN ('mild', 'moderate', 'severe')),
  notes             TEXT,
  strategies        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS behavior_logs_child_id_idx    ON behavior_logs (child_id);
CREATE INDEX IF NOT EXISTS behavior_logs_occurred_at_idx ON behavior_logs (occurred_at DESC);
