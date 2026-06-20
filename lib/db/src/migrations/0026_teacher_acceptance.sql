-- NOT wrapped in a transaction: ALTER TYPE ADD VALUE cannot run inside a transaction block.
ALTER TYPE engagement_status ADD VALUE IF NOT EXISTS 'pending_teacher_acceptance';
