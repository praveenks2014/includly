-- Adds activation_fee_order_id to support idempotent order/verify flow for the
-- activation fee, mirroring shadow_teacher_matches.placement_fee_order_id.

ALTER TABLE "shadow_teacher_engagements"
  ADD COLUMN IF NOT EXISTS "activation_fee_order_id" text;
