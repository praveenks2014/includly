-- Add parent home geo coordinates for home-visit distance matching
-- Stored only with explicit parent consent (shareHomeLocation=true)
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude double precision;
