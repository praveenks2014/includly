-- Add chat_access_only to contact_unlocks
-- TRUE = parent can only chat with the professional, not see full contact details
ALTER TABLE contact_unlocks ADD COLUMN IF NOT EXISTS chat_access_only boolean NOT NULL DEFAULT false;
