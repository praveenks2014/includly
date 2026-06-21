-- Add community_post_summaries table for caching AI-generated key takeaways
CREATE TABLE IF NOT EXISTS community_post_summaries (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL UNIQUE REFERENCES community_posts(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  answer_count_at_generation INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
