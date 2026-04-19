-- Add booking_messages table for per-booking parent-specialist chat threads
CREATE TABLE IF NOT EXISTS booking_messages (
  id         serial PRIMARY KEY,
  booking_id integer NOT NULL REFERENCES session_bookings(id) ON DELETE CASCADE,
  sender_id  integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_messages_booking_id_created_at
  ON booking_messages (booking_id, created_at);
