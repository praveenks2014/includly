-- Monetization restructure: admin-configurable placement/activation fees + flag-gated
-- salary/trial-direct-pay model for NEW engagements only. Existing ACTIVE engagements and
-- the matching-fee flow are untouched; new columns are nullable or default-backfilled to
-- preserve current behavior for all pre-existing rows.

ALTER TABLE "admin_settings"
  ADD COLUMN IF NOT EXISTS "placement_fee_inr" integer NOT NULL DEFAULT 2999,
  ADD COLUMN IF NOT EXISTS "activation_fee_inr" integer NOT NULL DEFAULT 999,
  ADD COLUMN IF NOT EXISTS "platform_salary_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "trial_direct_pay_enabled" boolean NOT NULL DEFAULT true;

ALTER TYPE "engagement_status" ADD VALUE IF NOT EXISTS 'pending_activation_fee';

ALTER TABLE "shadow_teacher_engagements"
  ADD COLUMN IF NOT EXISTS "platform_salary_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "placement_fee_inr" integer,
  ADD COLUMN IF NOT EXISTS "placement_fee_payment_id" integer,
  ADD COLUMN IF NOT EXISTS "activation_fee_inr" integer,
  ADD COLUMN IF NOT EXISTS "activation_fee_payment_id" integer;

ALTER TABLE "shadow_teacher_matches"
  ADD COLUMN IF NOT EXISTS "trial_direct_pay" boolean,
  ADD COLUMN IF NOT EXISTS "trial_direct_pay_marked_paid_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "trial_direct_pay_confirmed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "pending_commit_professional_id" integer REFERENCES "professional_profiles"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "pending_commit_start_date" text,
  ADD COLUMN IF NOT EXISTS "placement_fee_order_id" text,
  ADD COLUMN IF NOT EXISTS "placement_fee_amount_inr" integer;

ALTER TYPE "payment_plan" ADD VALUE IF NOT EXISTS 'plan_placement_fee';
ALTER TYPE "payment_plan" ADD VALUE IF NOT EXISTS 'plan_activation_fee';

CREATE TABLE IF NOT EXISTS "settings_audit_log" (
  "id" serial PRIMARY KEY,
  "admin_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "changes" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "engagement_salary_confirmations" (
  "id" serial PRIMARY KEY,
  "engagement_id" integer NOT NULL REFERENCES "shadow_teacher_engagements"("id") ON DELETE CASCADE,
  "month" text NOT NULL,
  "amount_inr" integer NOT NULL,
  "marked_paid_at" timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
