# Sproutly

## Overview

Sproutly is a marketplace connecting parents with Shadow Teachers, Special Educators (OT, Speech Therapy, Special Tutors), and Medical Specialists (Psychiatrist, Developmental Pediatrician, Neurologist) for children with special needs.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: Clerk (phone OTP primary)
- **Frontend**: React + Vite + Wouter + shadcn/ui + Tailwind CSS v4

## Packages

- `artifacts/api-server` — Express API server, port 8080
- `artifacts/sensei-link` — React frontend, Vite dev server
- `lib/api-spec` — OpenAPI spec (openapi.yaml) + Orval codegen config
- `lib/api-client-react` — Generated hooks + custom fetch (from Orval)
- `lib/db` — Drizzle schema + database client

## DB Schema

Tables:
- `users` — clerk_id, email, phone, full_name, role (parent/professional/admin), city, country
- `professional_profiles` — user_id FK, full_name, specialty (enum), bio, qualifications, years_experience, city, country, lat/lng, travel_radius_km, willing_to_travel, is_verified, verification_status (enum), average_rating, total_ratings, total_views, total_unlocks, phone, email
- `ratings` — parent_id FK, professional_id FK, score (1-5), comment
- `contact_unlocks` — parent_id FK, professional_id FK, unlocked_at
- `payments` — user_id FK, plan (enum), provider (stripe/razorpay), provider_payment_id, provider_order_id, amount_paise, currency, status (pending/completed/failed/refunded), professional_id FK, metadata
- `subscriptions` — user_id FK, provider, provider_subscription_id, plan, status, starts_at, expires_at
- `admin_settings` — single-row config table: contact_limit_per_parent (default 5)
- `user_certifications` — user_id FK, document_type, document_url (object storage path), notes, status (pending/approved/rejected), reviewed_at
- `identity_verifications` — professional_id FK, document_type (aadhar/passport/driving_licence/national_id), file_key (object storage path), status (pending/verified/rejected), dpdp_consent, submitted_at, reviewed_at

Enums:
- `specialty`: shadow_teacher, special_tutor, occupational_therapy, speech_therapy, psychiatrist, developmental_pediatrician, neurologist, therapy_centre
- `verification_status`: unsubmitted, pending, verified, rejected
- `id_document_type`: aadhar, passport, driving_licence, national_id
- `id_verification_status`: pending, verified, rejected
- `certification_status`: pending, approved, rejected
- `role`: parent, professional, admin
- `payment_provider`: stripe, razorpay
- `payment_status`: pending, completed, failed, refunded
- `payment_plan`: plan_a_subscription, plan_b_per_contact, plan_c_featured

## Pages

- `/` — Landing page (redirects to /dashboard if signed in)
- `/sign-in`, `/sign-up` — Clerk auth pages
- `/search` — Search professionals by specialty, city, experience, travel
- `/professionals/:id` — Professional profile with unlock flow
- `/dashboard` — Role-aware dashboard (parent / professional)
- `/onboard` — Multi-step professional profile creation/edit
- `/account` — Account settings
- `/pricing` — Pricing page with Plan A/B/C cards, Razorpay integration
- `/payment/success` — Post-payment success confirmation
- `/payment/cancel` — Cancelled payment redirect
- `/privacy`, `/terms`, `/support` — Compliance pages
- `/admin` — Admin dashboard (role=admin required): Professionals tab (approve/reject), Stats tab, Settings tab

## Admin Access

To grant admin access to a user, run this SQL against the database:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
```
The user must be signed in to see the admin dashboard. Non-admins get a 403/Access Denied page.

## Admin Routes (API)

All admin routes require `role = admin`:
- `GET /api/admin/professionals?status=pending&page=1&limit=20` — List professionals with user info
- `PATCH /api/admin/professionals/:id/approve` — Approve (sets verificationStatus=verified, isVerified=true)
- `PATCH /api/admin/professionals/:id/reject` — Reject (sets verificationStatus=rejected, isVerified=false)
- `GET /api/admin/stats` — Platform stats (total users/professionals/parents, unlocks this month, pending/verified/rejected counts)
- `GET /api/admin/settings` — Get admin settings (auto-creates defaults if missing)
- `PATCH /api/admin/settings` — Update settings (contactLimitPerParent)

## Monetization

- **Plan A** (₹499/30 days): Premium subscription — unlimited contact unlocks for 30 days
- **Plan B** (₹99/contact): Pay-per-contact — unlock one professional's contact details
- **Plan C** (₹299/30 days): Featured listing for professionals
- Payment providers: Razorpay (primary, INR), Stripe (secondary — needs STRIPE_SECRET_KEY)
- Razorpay: needs `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` env secrets
- Stripe webhook: POST /api/webhooks/stripe (set STRIPE_WEBHOOK_SECRET for signature verification)
- After payment verified: Plan A creates subscription row, Plan B inserts contact_unlock row

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Seeded Data (dev only)

6 professionals: Priya Sharma (shadow_teacher, Mumbai), Dr. Arjun Mehta (developmental_pediatrician, Bangalore), Sunita Rao (speech_therapy, Delhi), Kavitha Iyer (occupational_therapy, Chennai), Rahul Verma (special_tutor, Pune), Dr. Neha Gupta (psychiatrist, Hyderabad)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
