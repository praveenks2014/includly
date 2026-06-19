ALTER TYPE lifecycle_request_type ADD VALUE IF NOT EXISTS 'pause';
ALTER TYPE lifecycle_request_type ADD VALUE IF NOT EXISTS 'resume';

ALTER TABLE engagement_lifecycle_requests
  ADD COLUMN IF NOT EXISTS peer_response_by_user_id integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS peer_responded_at         timestamptz;
