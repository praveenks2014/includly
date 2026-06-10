# Replit Agent Prompt — Includly: Therapy Centre Bookings Module

Copy everything below the line into Replit Agent.

-----

## ROLE & CONTEXT

You are extending **Includly** (includly.in), a live marketplace connecting parents of children with special needs to professionals (shadow teachers, specialists). You are adding a **Therapy Centre Bookings** module.

**Before writing any code, audit the existing codebase** and report back what you find:

- Current stack (framework, database, ORM, file structure)
- Auth setup (Clerk) and how user roles are modeled
- The Razorpay integration: escrow-style payment ledger, session OTP verification flow, and the admin-configurable commission/pricing system
- The existing parent onboarding flow (progressive, conditional tab disclosure)
- Existing booking, session, and professional-profile models

**Reuse these patterns.** Do not introduce a second framework, a parallel auth system, or a new payment flow. The therapy centre module is additive — all existing shadow-teacher/specialist flows must continue working unchanged.

## CRITICAL INSTRUCTION — ASK BEFORE PROCEEDING

Before writing any code:

1. Ask me every question in **Section 14 (Questions you must ask me first)**.
1. Also ask about anything in this spec that is ambiguous, conflicts with the existing codebase, or requires a product decision. **Never assume — ask.**
1. After I answer, restate your build plan in a short summary and wait for my confirmation.

Repeat this behavior at every phase checkpoint in Section 13.

## HARD RULES (apply throughout)

- **Privacy first.** This platform holds data about children with special needs. Enforce least-privilege access: a centre can only see data for children with an active or past booking at that centre, and only what the parent has consented to share.
- **No child PII to external AI.** When calling any LLM API, never send the child’s real name, photos, contact details, or identifiers. Refer to the child generically (“the child”, age band, concern category only).
- **AI never auto-sends.** Every AI-generated response must be reviewed, editable, and explicitly sent by a human at the centre.
- **Pricing is server-side only.** All prices come from admin-approved config in the database. Never trust price values from the client.
- **Audit logs** for all pricing changes and all AI-assisted responses.

## 1. ROLES & PERMISSIONS

Extend the existing role system with:

- **centre_admin** — owns a therapy centre profile; manages therapists, services, availability, bookings, queries, milestones, and feedback responses for that centre.
- **platform_admin** (extend existing admin) — verifies centres, sets pricing per centre, sets commission per centre, views audit logs.
- **parent** (existing) — gains access to: therapy centre discovery/booking, session feedback, concerns log, milestone tracking/sharing, support queries.

Therapists are **profile records managed by the centre_admin**, not separate logins, in this version (confirm in Section 14).

## 2. CENTRE ONBOARDING & VERIFICATION

Flow for a new centre (centre_admin signs up via existing Clerk auth, selects “Therapy Centre” account type):

1. **Centre profile:** name, description, address + map pin, photos, contact phone/email, languages spoken, therapy types offered (Occupational Therapy, Speech Therapy, Behavioral/ABA, Physiotherapy, Special Education, Child Psychology, Sensory Integration — keep this list admin-editable), operating hours per day.
1. **Registrations & credentials:** registration/license numbers, certificates (file upload), years in operation.
1. **Therapist roster:** for each therapist — name, photo, specialization(s), qualifications, years of experience.
1. **Service catalog (no prices):** centre lists services it offers — e.g., Initial Assessment, OT Session, Speech Session, Group Session — each with type, duration, mode (in-centre / home visit / online), and short description. **Centres do not set prices** (see Section 3).
1. **Submission → verification queue.** Centre status: `draft → submitted → verified → live` (or `rejected` with reason). Only `live` centres appear in discovery. Platform admin reviews credentials before approving.

Centre dashboard after going live: bookings calendar, today’s sessions, pending queries, feedback received, read-only pricing.

## 3. ADMIN-CONTROLLED PRICING (per centre)

This is a core requirement. In the **platform admin portal**:

- A page per centre listing all its services. Admin sets, for each service: **price (INR)**, and can override the platform-default **commission %** for that centre.
- Price changes take effect from a chosen date; maintain a **price history table** (who changed, old → new, when, effective date) — never overwrite silently.
- Centres see their pricing **read-only** and can submit a “price change request” with justification; admin approves/rejects from a request queue.
- Booking and checkout always read the current effective admin-approved price from the server.
- A centre cannot go live until admin has set prices for all its services.

## 4. DISCOVERY & BOOKING (assessment-first)

**Discovery:** parents browse/search centres by therapy type, location/distance, price range, rating, language, mode. Centre detail page shows profile, therapists, services with prices, ratings/feedback, and available slots.

**Booking flow (reuse existing escrow + OTP mechanics):**

1. Parent selects a service. If the child has never been assessed at this centre, default the flow to booking an **Initial Assessment** first (centres can mark services as “assessment required before booking” per service).
1. Parent picks a slot from the centre’s availability calendar (centre_admin manages availability; per-therapist scheduling can come later — confirm in Section 14).
1. Parent selects which child the booking is for (children come from the existing parent profile), and chooses what to share with the centre: child’s needs profile and selected concern entries (consent checkboxes, default ON for items marked shareable).
1. Payment via existing Razorpay escrow flow; platform commission per Section 3.
1. Confirmation generates the **session OTP** exactly like existing bookings.

**Cancellation/rescheduling:** implement a policy engine with admin-configurable windows (e.g., free cancellation ≥24h before; partial/no refund inside the window; centre no-show = full refund). Exact rules: ask me in Section 14.

## 5. SESSION LIFECYCLE & FEEDBACK

- **Pre-session:** reminder notification with time, location/map link, therapist name, and the child’s shared concerns surfaced to the centre on the session detail page.
- **Session day:** centre enters the parent’s OTP to mark the session started/attended (existing mechanic). Completion triggers escrow release per existing ledger logic.
- **Post-session — centre side:** centre marks complete and may add a short **session note** (what was worked on, home activity suggestion) visible to the parent.
- **Post-session — parent feedback (required feature):**
  - Prompted after completion: star rating (1–5) + quick tags (punctuality, child engagement, communication, environment, value) + free-text comment.
  - Toggle: feedback visible publicly on the centre profile vs. private to centre + admin. Default public for rating, with free text shown publicly only if parent opts in.
  - Centre ratings aggregate on the profile; show averages only after ≥3 ratings to protect anonymity. Centre may post **one** public reply per feedback.
  - Feedback never blocks escrow release; it is post-completion and optional after a reminder.

## 6. PARENT CONCERNS LOG (required feature)

A per-child log where parents record concerns about their kid:

- Fields: category (speech, behavior, attention, sensory, motor, social, sleep, eating, school, other), title, description, severity (low/medium/high), date observed, optional follow-up notes.
- **Visibility control per entry:** “Private (only me)” or “Share with my booked centres”. Shared entries are visible to centres with an active/past booking for that child.
- Status workflow: `open → discussed → improving → resolved` (parent-controlled; centre can add comments on shared entries).
- Shared concerns appear: (a) on the centre’s session detail page before each session, (b) in the AI context for support queries (Section 8) if shared.
- Timeline view per child so the parent can see concern history alongside milestones.

## 7. MILESTONES — TRACK & SHARE (required feature)

Per-child milestone tracker:

- Fields: title, domain (speech & communication, motor, social, behavior/regulation, academic, self-care), date achieved, description, recorded by (parent or centre).
- Both the parent and a booked centre’s centre_admin can record milestones for the child (centre-recorded milestones require parent’s child link via a booking).
- **Timeline view** per child combining milestones (and optionally concerns) chronologically — this is the child’s progress story.
- **Sharing:**
  - In-app: milestone timeline is visible to centres the parent has booked with (respecting the same consent model as concerns).
  - Outward share: a “Share progress” action generating a clean, branded **progress summary card (image) and PDF** for a chosen date range, suitable for WhatsApp sharing with family or other professionals. No platform login required to view the shared artifact; it contains only what the parent chose to include.
- Optional photo per milestone — confirm media handling in Section 14 before building uploads.

## 8. SUPPORT QUERIES WITH AI-DRAFTED RESPONSES (required feature)

Parents can raise queries to a centre; the centre answers with AI assistance and human review:

**Parent side:**

1. From a centre page or a booking, parent opens “Ask the centre” → category (scheduling, therapy question, progress, billing, other), free-text question, optionally linked to a specific child/booking.
1. Query appears as a thread; parent is notified on reply and can follow up in-thread.

**Centre side (the AI-assisted part):**

1. Centre_admin opens the query and clicks **“Generate suggested replies”**.
1. The backend calls the LLM with: the query text, category, the service/booking context, the centre’s own description/services, and — only if the parent shared them — anonymized summaries of relevant concerns. **Never any child PII (Hard Rules).**
1. The LLM returns **3 draft responses with different tones/approaches** (e.g., reassuring + informational, action-oriented with next steps, brief acknowledgment + request for a call). Prompt the LLM to return strict JSON: `[{label, draft}]`.
1. UI shows the three drafts as selectable cards. Centre picks one → it loads into an editable text box → centre edits freely → clicks Send. The centre can also discard all drafts and write from scratch, or regenerate.
1. **No auto-send, ever.** Sending is always an explicit human action.
1. Log per response: query id, drafts generated, which draft chosen (or none), final sent text, editor user id, timestamps. (Admin can review these logs.)
1. Parent-visible footer on AI-assisted replies: “Reviewed and sent by [Centre name].” Add a platform-level disclaimer that responses are general guidance, not medical advice.

**LLM integration:** use an API key stored in Replit Secrets. Ask me which provider/key to use (Section 14) before wiring it. Build the LLM call behind a single server-side service module so the provider can be swapped.

## 9. ADMIN PORTAL EXTENSIONS

Extend the existing admin portal with:

- **Centre verification queue** (approve/reject with reason; view uploaded credentials).
- **Per-centre pricing manager** + price change request queue + price audit log (Section 3).
- **Per-centre commission override** (falls back to platform default).
- **Centres overview:** status, bookings count, revenue, average rating, open queries.
- **Feedback moderation:** hide abusive feedback with a logged reason.
- **AI response logs** viewer (Section 8).
- **Config:** therapy-type list, cancellation policy windows, feedback tag list.

## 10. NOTIFICATIONS

Reuse the existing notification approach (in-app + email). Events: booking confirmed, session reminder (24h and 2h before), OTP/session started, session completed + feedback prompt, query replied, milestone recorded by centre, price change affecting an upcoming booking, centre verification decision.

## 11. DATA MODEL SKETCH (adapt names to existing conventions)

- `therapy_centres` (owner_user_id, profile fields, status, verification metadata)
- `centre_therapists` (centre_id, name, photo, specializations, qualifications, experience)
- `centre_services` (centre_id, type, name, duration_min, mode, description, assessment_required, active)
- `centre_service_prices` (service_id, price_inr, commission_pct_override, effective_from, set_by_admin_id) — history table, current price = latest effective row
- `price_change_requests` (centre_id, service_id, requested_price, justification, status, decided_by, decided_at)
- `therapy_bookings` (extend existing bookings if clean; else new table referencing child_id, centre_id, service_id, therapist_id nullable, slot, status, otp fields, payment/ledger refs)
- `session_feedback` (booking_id, rating, tags[], comment, public_flags, centre_reply, moderation fields)
- `child_concerns` (child_id, category, title, description, severity, status, visibility, dates)
- `concern_comments` (concern_id, author, text, created_at)
- `child_milestones` (child_id, domain, title, description, achieved_on, recorded_by, photo_url nullable)
- `progress_shares` (child_id, range, included_item_ids, share_token, created_by)
- `support_queries` (parent_id, centre_id, child_id nullable, booking_id nullable, category, status)
- `support_query_messages` (query_id, sender, text, ai_assisted boolean)
- `ai_draft_logs` (query_id, drafts_json, chosen_index nullable, final_text, editor_id, created_at)
- `admin_audit_log` (actor, action, entity, before/after, timestamp)

## 12. ACCEPTANCE CRITERIA (test these before calling a phase done)

- Existing shadow-teacher booking and payment flows still pass end-to-end.
- A centre cannot appear in discovery without admin verification AND admin-set prices.
- Checkout total always matches the admin-set effective price server-side.
- A centre can never view a child’s private concern entries or another centre’s data.
- An AI draft can never reach a parent without a centre user explicitly clicking Send.
- No request to the LLM contains a child’s name or contact details (write a test that inspects the outbound payload).
- Feedback, concerns, milestones, and queries all render correctly on mobile-width screens.

## 13. BUILD ORDER (checkpoint with me after each phase)

1. **Phase 1:** Codebase audit report → roles → centre onboarding & verification → service catalog → admin pricing manager.
1. **Phase 2:** Discovery, booking with existing escrow + OTP, cancellation policy, session lifecycle, session feedback.
1. **Phase 3:** Concerns log + milestones tracking + progress sharing (timeline views).
1. **Phase 4:** Support queries with AI-drafted responses + admin AI logs.
1. **Phase 5:** Notifications polish, admin overview dashboards, end-to-end testing against Section 12.

At each checkpoint: show me what was built, list anything you deviated on and why, and ask before starting the next phase.

## 14. QUESTIONS YOU MUST ASK ME FIRST (before any code)

1. Should therapists have their own logins now, or remain records managed by the centre_admin (recommended for v1)?
1. Availability: one shared centre calendar (simpler) or per-therapist calendars from day one?
1. Cancellation/refund policy: confirm the exact windows and refund percentages, and the no-show rules for both sides.
1. Which LLM provider and API key should I use for the AI reply drafts (configure via Replit Secrets)?
1. Milestones: allow photo uploads in v1, or text-only first? If photos, confirm the storage approach used elsewhere in the app.
1. Should service prices be publicly visible to logged-out visitors, or only after login?
1. Default visibility for a new concern entry: private, or shared with booked centres?
1. Do you want session **packages** (e.g., 8-session bundles with per-session escrow release) in this build, or defer to a later phase? If now: is escrow held fully upfront and released per completed session?
1. Anything in the existing codebase I should treat as frozen/untouchable?

If any other ambiguity or conflict appears at any point, stop and ask me before proceeding.