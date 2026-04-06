-- Migration: Add geo columns to professional_profiles
-- These columns enable location-based search with Haversine distance filtering

ALTER TABLE professional_profiles
  ADD COLUMN IF NOT EXISTS latitude real,
  ADD COLUMN IF NOT EXISTS longitude real,
  ADD COLUMN IF NOT EXISTS travel_radius_km integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS willing_to_travel boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN professional_profiles.latitude IS 'WGS-84 latitude in decimal degrees';
COMMENT ON COLUMN professional_profiles.longitude IS 'WGS-84 longitude in decimal degrees';
COMMENT ON COLUMN professional_profiles.travel_radius_km IS 'Maximum distance the professional is willing to travel, in km';
COMMENT ON COLUMN professional_profiles.willing_to_travel IS 'Whether the professional is open to travelling to clients';
