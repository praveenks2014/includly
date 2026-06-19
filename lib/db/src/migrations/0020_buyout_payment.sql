ALTER TABLE engagement_lifecycle_requests
  ADD COLUMN IF NOT EXISTS buyout_order_id   text,
  ADD COLUMN IF NOT EXISTS buyout_payment_id text,
  ADD COLUMN IF NOT EXISTS buyout_fee_inr    integer;
