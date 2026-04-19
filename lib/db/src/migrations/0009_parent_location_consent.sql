-- Add explicit location-sharing consent flag for parents
ALTER TABLE users ADD COLUMN IF NOT EXISTS share_home_location boolean NOT NULL DEFAULT false;
