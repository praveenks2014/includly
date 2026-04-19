-- Add full clinic address field for post-booking location reveal
ALTER TABLE professional_profiles ADD COLUMN IF NOT EXISTS clinic_address text;
