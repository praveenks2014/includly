-- Phase 3: Location sharing in chat + trial location on match
ALTER TABLE shadow_match_messages ADD COLUMN IF NOT EXISTS msg_type text NOT NULL DEFAULT 'text';
ALTER TABLE shadow_teacher_matches ADD COLUMN IF NOT EXISTS trial_location text;
