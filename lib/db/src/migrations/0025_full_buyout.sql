-- NOT wrapped in a transaction: ALTER TYPE ADD VALUE cannot run inside a transaction block.
ALTER TYPE lifecycle_request_method ADD VALUE IF NOT EXISTS 'full_buyout';
