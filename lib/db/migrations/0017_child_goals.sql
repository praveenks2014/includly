-- 2A/2B: child goals table for goal-based daily logging
CREATE TABLE IF NOT EXISTS child_goals (
  id                  SERIAL PRIMARY KEY,
  child_id            INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  engagement_id       INTEGER REFERENCES shadow_teacher_engagements(id) ON DELETE SET NULL,
  created_by_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label               TEXT NOT NULL,
  category            TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS child_goals_child_id_idx      ON child_goals(child_id);
CREATE INDEX IF NOT EXISTS child_goals_engagement_id_idx ON child_goals(engagement_id);
