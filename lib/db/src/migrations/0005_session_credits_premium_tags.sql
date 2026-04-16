-- Add session_credits to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_credits integer NOT NULL DEFAULT 0;

-- Add is_premium and specialization_tags to professional_profiles
ALTER TABLE professional_profiles ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;
ALTER TABLE professional_profiles ADD COLUMN IF NOT EXISTS specialization_tags text[] NOT NULL DEFAULT '{}';

-- Extend payment_plan enum with session pass plans
ALTER TYPE payment_plan ADD VALUE IF NOT EXISTS 'plan_session_pass_5';
ALTER TYPE payment_plan ADD VALUE IF NOT EXISTS 'plan_session_pass_10';
