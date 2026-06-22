-- 1. Add child_id column (nullable FK to children)
ALTER TABLE connect_threads ADD COLUMN IF NOT EXISTS child_id integer REFERENCES children(id) ON DELETE SET NULL;

-- 2. Backfill child_id from shadow_teacher_engagements (authoritative source per engagement)
UPDATE connect_threads ct
SET child_id = sub.child_id
FROM (
  SELECT DISTINCT ON (parent_id, professional_id)
    parent_id, professional_id, child_id
  FROM shadow_teacher_engagements
  WHERE child_id IS NOT NULL
  ORDER BY parent_id, professional_id, created_at DESC
) sub
WHERE sub.parent_id = ct.parent_id
  AND sub.professional_id = ct.professional_id
  AND ct.child_id IS NULL;

-- 3. Dedupe: within each (parent_id, professional_id, COALESCE(child_id, 0)) group keep the oldest thread.
--    connect_messages cascade-deletes automatically via ON DELETE CASCADE on thread_id FK.
DELETE FROM connect_threads
WHERE id NOT IN (
  SELECT MIN(id)
  FROM connect_threads
  GROUP BY parent_id, professional_id, COALESCE(child_id, 0)
);

-- 4. Unique index: one thread per (parent, professional, child)
CREATE UNIQUE INDEX IF NOT EXISTS connect_threads_unique_parent_prof_child_idx
  ON connect_threads (parent_id, professional_id, COALESCE(child_id, 0));
