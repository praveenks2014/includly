-- Phase 5: content gating + community Q&A
-- Run after 0002_assessments.sql

-- ─── 1. Resources table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resources (
  id                    serial       PRIMARY KEY,
  slug                  text         NOT NULL UNIQUE,
  title                 text         NOT NULL,
  excerpt               text         NOT NULL,
  body                  text,
  author                text         NOT NULL,
  category              text         NOT NULL DEFAULT 'general',
  tag                   text         NOT NULL,
  read_time_minutes     integer      NOT NULL DEFAULT 5,
  is_premium            boolean      NOT NULL DEFAULT false,
  is_course             boolean      NOT NULL DEFAULT false,
  course_pricing_inr    integer,
  course_expert_user_id integer      REFERENCES users(id) ON DELETE SET NULL,
  is_published          boolean      NOT NULL DEFAULT true,
  published_at          timestamptz  NOT NULL DEFAULT now(),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);

-- Seed 8 existing articles (4 free, 4 premium)
INSERT INTO resources (slug, title, excerpt, author, category, tag, read_time_minutes, is_premium, is_course, published_at) VALUES
  ('iep-guide',
   'Understanding Your Child''s IEP: A Step-by-Step Guide for Indian Parents',
   'Navigating an Individualised Education Plan can feel overwhelming. This guide walks you through every section — goals, accommodations, and how to advocate effectively in school meetings.',
   'Priya Nair, Special Educator', 'iep', 'IEP Help', 8, false, false, '2026-04-10'),
  ('autism-early-signs',
   'Early Signs of Autism Spectrum Disorder: What to Look For at Ages 1–3',
   'Early intervention makes a measurable difference. Learn the developmental milestones to watch, red flags to note, and how to approach a formal assessment with a developmental pediatrician.',
   'Dr. Ananya Sharma, Developmental Pediatrician', 'diagnosis', 'Diagnosis', 6, false, false, '2026-03-28'),
  ('sensory-shadow',
   'Sensory Processing and the Classroom: Tips for Shadow Teachers',
   'When a child experiences sensory overload, the classroom can become a challenging environment. This article covers practical strategies shadow teachers can use to support regulation.',
   'Rohan Mehta, Occupational Therapist', 'professionals', 'For Professionals', 7, true, false, '2026-04-02'),
  ('affordable-therapy',
   'Finding Affordable Therapy in Tier-2 Indian Cities',
   'Access to quality special education support isn''t limited to metros. Here''s how families in cities like Indore, Coimbatore, and Patna can find verified professionals without breaking the bank.',
   'Includly Team', 'parents', 'For Parents', 5, false, false, '2026-03-15'),
  ('speech-home-tips',
   'Speech Therapy at Home: 10 Activities You Can Do Between Sessions',
   'Consistency between formal sessions accelerates progress. Speech therapist Meenakshi Iyer shares easy, fun activities using everyday objects that parents can practice with their child daily.',
   'Meenakshi Iyer, Speech Therapist', 'therapy', 'Therapy Tips', 9, true, false, '2026-04-18'),
  ('adhd-journey',
   'Our Journey with ADHD: How We Found the Right Support',
   'Sunita''s son was 6 when he was diagnosed with ADHD. Three years later, she shares the professionals who helped, the resources that worked, and the community that kept her going.',
   'Sunita Kapoor, Parent', 'community', 'Community Story', 6, false, false, '2026-04-05'),
  ('aba-therapy-india',
   'ABA Therapy in India: What Parents Need to Know Before Starting',
   'Applied Behaviour Analysis has strong evidence behind it — but implementation varies widely. This guide covers what to look for in an ABA therapist, session structure, and red flags to avoid.',
   'Dr. Kavitha Rao, Behaviour Analyst', 'therapy', 'Therapy Tips', 10, true, false, '2026-03-22'),
  ('document-progress',
   'How to Document Your Child''s Progress for School Meetings',
   'Detailed records make you a more effective advocate. Learn which observations to track, how to organise them, and how to present data constructively to your child''s school team.',
   'Includly Team', 'iep', 'IEP Help', 5, true, false, '2026-04-22')
ON CONFLICT (slug) DO NOTHING;

-- Seed 2 sample mini-courses
INSERT INTO resources (slug, title, excerpt, author, category, tag, read_time_minutes, is_premium, is_course, course_pricing_inr, published_at) VALUES
  ('iep-masterclass',
   'IEP Masterclass: Advocate Like a Pro (Video Course)',
   'A 6-part video course covering every aspect of IEP planning and school meetings, taught by a veteran special educator with 15 years of experience in Indian schools.',
   'Priya Nair, Special Educator', 'iep', 'Mini-Course', 120, false, true, 999, '2026-05-01'),
  ('sensory-diet-course',
   'Building a Sensory Diet for Your Child (Video Course)',
   'Learn how to create personalised sensory activities for your child in collaboration with your OT — a practical course for parents and caregivers.',
   'Rohan Mehta, Occupational Therapist', 'therapy', 'Mini-Course', 90, false, true, 799, '2026-05-10')
ON CONFLICT (slug) DO NOTHING;

-- ─── 2. Community enums ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE community_report_status AS ENUM ('pending', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE community_report_target AS ENUM ('post', 'answer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 3. Community posts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_posts (
  id              serial       PRIMARY KEY,
  author_user_id  integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           text         NOT NULL,
  body            text         NOT NULL,
  topic_tag       text         NOT NULL DEFAULT 'general',
  is_anonymous    boolean      NOT NULL DEFAULT false,
  is_hidden       boolean      NOT NULL DEFAULT false,
  upvote_count    integer      NOT NULL DEFAULT 0,
  answer_count    integer      NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_posts_topic_idx   ON community_posts(topic_tag);
CREATE INDEX IF NOT EXISTS community_posts_created_idx ON community_posts(created_at DESC);

-- ─── 4. Community answers (professionals only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS community_answers (
  id                      serial       PRIMARY KEY,
  post_id                 integer      NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_professional_id  integer      NOT NULL REFERENCES professional_profiles(id) ON DELETE CASCADE,
  body                    text         NOT NULL,
  upvote_count            integer      NOT NULL DEFAULT 0,
  is_hidden               boolean      NOT NULL DEFAULT false,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_answers_post_idx ON community_answers(post_id);

-- ─── 5. Vote tables (one vote per user per item) ───────────────────────────────
CREATE TABLE IF NOT EXISTS community_post_votes (
  id          serial       PRIMARY KEY,
  post_id     integer      NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS community_answer_votes (
  id          serial       PRIMARY KEY,
  answer_id   integer      NOT NULL REFERENCES community_answers(id) ON DELETE CASCADE,
  user_id     integer      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (answer_id, user_id)
);

-- ─── 6. Reports ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_reports (
  id                serial                  PRIMARY KEY,
  target_type       community_report_target NOT NULL,
  target_id         integer                 NOT NULL,
  reporter_user_id  integer                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason            text                    NOT NULL,
  status            community_report_status NOT NULL DEFAULT 'pending',
  reviewed_at       timestamptz,
  created_at        timestamptz             NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_reports_status_idx ON community_reports(status);
