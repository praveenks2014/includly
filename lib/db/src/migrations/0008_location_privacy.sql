-- Add display_area (human-readable neighbourhood/city label for pre-booking display)
-- and offers_home_visits (toggle for applicable specialist types) to professional_profiles
ALTER TABLE professional_profiles ADD COLUMN IF NOT EXISTS display_area text;
ALTER TABLE professional_profiles ADD COLUMN IF NOT EXISTS offers_home_visits boolean NOT NULL DEFAULT false;
