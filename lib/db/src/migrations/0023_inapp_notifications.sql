-- In-app notifications table (separate from push_subscriptions)
CREATE TABLE notifications (
  id           serial PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         varchar(80) NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL,
  is_read      boolean NOT NULL DEFAULT false,
  related_id   integer,
  related_type varchar(50),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id     ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread  ON notifications(user_id) WHERE is_read = false;
