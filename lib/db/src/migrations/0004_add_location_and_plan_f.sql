-- Add location column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS location text;

-- Add plan_f_per_booking to payment_plan enum
ALTER TYPE payment_plan ADD VALUE IF NOT EXISTS 'plan_f_per_booking';
