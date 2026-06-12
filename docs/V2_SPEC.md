# Includly V2 — Personalized Care, Booking & Progress Spec

This spec builds on what already exists in includly.in. It does not re-describe shipped features (10-state booking lifecycle, OTP verification, contact unlocks, shadow-teacher matching, mood logs, centre module, chat, payouts, nudge scheduler). Each section states what exists, what changes, and what is new, so it can be handed to Claude Code phase by phase.

The central design decision: introduce a **Child Profile** as a first-class entity. Today personalization hangs off the parent user; in V2 every search, booking, session note, and progress chart hangs off a child. One parent can have multiple children, and a child can have multiple providers (a "care team").

---

## 1. Child Profile (the foundation)

### Why
Every downstream feature — personalized recommendations, pre-filled search filters, intake sharing, goals, progress charts, care team — needs a child entity. Without it, progress tracking has nowhere to live and parents repeat their child's story to every provider.

### Onboarding wizard (parent first-run, after Clerk signup)
A 6-step wizard, skippable after step 2, resumable later. Tone matters: warm, non-clinical language, never "disorder" labels as headlines.

1. **Basics** — child's name or nickname (explicitly offer "nickname only" for privacy), date of birth (derive age band), gender (optional, "prefer not to say" default-available).
2. **Needs** — diagnosis status: `diagnosed` / `under assessment` / `exploring concerns`. Conditions multi-select reusing your existing specialization tag vocabulary (autism, ADHD, speech delay, Down syndrome, CP, learning difficulties…), with a prominent "Not sure yet — help me figure out where to start" path that routes to the Get Matched flow instead of demanding labels.
3. **Current situation** — school type (mainstream / special school / homeschool / not enrolled), grade, existing therapies and frequency, languages spoken at home (critical in India: therapy in Telugu vs Hindi vs English is a real filter).
4. **Goals** — what the parent wants help with, multi-select: communication, behavior, school inclusion/shadow support, academics, motor skills, social skills, daily living skills, sports/art for development. These map to provider specialties.
5. **Logistics** — city + locality (reuse geo), budget band, preference for home visit / centre / online, available time windows (weekday evenings, weekend mornings…).
6. **About my child (for providers)** — free-text + structured chips: what calms them, known triggers, communication mode (verbal / AAC / gestures / emerging), favorite activities. This becomes the **intake card** shared with providers (Section 3).

End state: a completion meter on the child card; profiles ≥80% complete unlock the personalized Care Plan home.

### Consent model (DPDP Act — children's data)
- Verifiable parental consent checkbox + timestamp stored at child creation; the parent account is the data fiduciary's consent anchor.
- Per-child consent toggles: share intake with booked providers (default on), allow photos/videos in progress evidence (default **off**), include child in monthly reports (default on).
- Every provider view of a child profile writes to an audit log the parent can see ("Who has seen Aarav's profile").
- No behavioral tracking or ads keyed to child data. Child data is excluded from any analytics events beyond aggregate counts.
- Right to erasure: deleting a child cascades to goals, notes, evidence, and intake shares (bookings/payments are retained but de-linked to an anonymized child reference for accounting).

---

## 2. Personalized parent home ("Care Plan")

### What exists
Search with geo + filters; shadow-teacher match-request widget; active-engagement card.

### What changes
After onboarding, the parent home becomes a per-child Care Plan feed (child switcher at top for multi-child families):

- **Recommended next steps** derived from goals: e.g., speech-delay + school-inclusion goals → "Speech Therapist (recommended 2x/week)" and "Shadow Teacher" cards, each with 3 match-scored providers and a "See all" into pre-filtered search.
- **Match score** per provider (shown as "Great match" / "Good match", not a raw number): weighted overlap of specialization tags vs child conditions+goals, distance vs travel radius, fee vs budget band, language match, age-band experience, rating, verified status. Implement as a SQL-side score in the existing search endpoint (new optional `childId` param) so pagination still works.
- **Two paths, always visible:** "Find on my own" (search pre-filled from child profile) and **"Get matched"** — generalize the existing shadow-teacher matching system to all specialties. Same lifecycle (`requested → matched → active → completed`), same admin assignment screen, new `specialty` field on the match request. You already built this engine; this is a widening, not a rebuild.
- The existing ShadowTeacherRequestWidget becomes a specialty-aware MatchRequestWidget.

---

## 3. Booking enhancements

### What exists
10-state lifecycle with OTP start/end, cancellation policy engine, Razorpay capture+refund, ₹49 platform fee, credit/session-pass model, calendar availability, centre services.

### 3.1 Booking is now child-scoped
`session_bookings` gains `childId`. The booking modal asks "Who is this session for?" (defaults to the only/last child). All downstream notes, goals, and charts key off this.

### 3.2 Pre-session intake share (the personalization payoff)
On `accepted`/`paid_held`, the provider sees the child's **intake card** (step-6 data + age band + goals + languages) — never the parent's contact beyond what the unlock model already governs. Banner on the provider's booking view: "You're meeting Aarav, 6 — communicates with gestures, calms with music, working on 2-word phrases." Parents stop repeating their story; first sessions start warmer. Respect the consent toggle.

### 3.3 Assessment-first flow for therapists (speech, OT, behavioral)
First booking with a new therapist is typed `assessment` (provider can price it differently, often lower). After completing it, the therapist submits a short **plan proposal** from a template: recommended frequency (e.g., 2x/week), 2–4 starter goals (Section 5), and an optional package offer. Parent reviews in-app and one-tap accepts → goals are created and a recurring schedule is proposed. This single flow converts a one-off booking into an ongoing relationship — the core economics of the platform.

### 3.4 Recurring bookings (biggest functional gap)
Therapy is 2–3x/week for months; today every session is a separate manual booking.
- New `recurring_booking_rules`: child, provider, weekday(s)+time, start date, end condition (date or N sessions), auto-renew flag.
- A scheduler job (extend the existing 1-hour nudge scheduler) materializes concrete `session_bookings` 7 days ahead, respecting the provider's availability and skipping conflicts (notify both sides on a skip).
- Payment options per rule: per-session auto-charge via existing flow, deduct from an active package, or weekly batch.
- Cancellation of a single occurrence uses the existing policy engine; cancelling the rule ends future materialization only.

### 3.5 Session packages
Providers (and centres, via their services tab) define packages: name, session count, price, validity days, applicable service. Parent buys via Razorpay (international cards via Stripe fallback), gets `package_purchases` with `remainingSessions`; bookings against the package decrement atomically in a transaction (same pattern as your session-credit deduction — `UPDATE ... WHERE remaining_sessions > 0`). Expiry handled by `validUntil`. Refund rule: unused sessions refundable pro-rata inside the cancellation window, configurable in admin settings. Packages improve provider cash flow and parent commitment; platform takes the same commission %, collected upfront.

### 3.6 Provider-type specifics
- **Sports/art/coaching trainers:** demo session type (free or token-priced, provider's choice) + **batch enrollment** — monthly group slots with capacity (see group sessions, Section 6.4).
- **Doctors (neurologist, developmental pediatrician):** consult bookings stay one-off; add an optional pre-visit document upload (reports/prescriptions) attached to the booking, visible to the doctor only, and a "follow-up in N weeks" quick-rebook the doctor can trigger at session end.
- **Centres:** allow back-to-back multi-service booking in one checkout (OT 4pm + speech 4:45pm) — implemented as a booking group sharing one payment.
- **Online sessions:** mode flag on availability slots (`in_person` / `online` / `home_visit`); online bookings auto-attach a meeting link field the provider fills (or integrate later); OTP verification still applies (parent reads OTP on the call).
- **Waitlist:** if a slot is full, parent joins a waitlist; on cancellation the first waitlisted parent gets a push with a 2-hour hold.

---

## 4. Post-booking loop (retention engine)

### What exists
Mood logs, ratings after completion, chat, dispute states, nudge scheduler.

### The loop
reminder → OTP start → session → OTP end → **provider note (≤2 min)** → parent summary push → **home practice** → mood log → next-session nudge → weekly digest → monthly report.

### 4.1 Structured session notes (new)
After `session_ended`, the provider fills a specialty-templated note: what we worked on (chips + free text), per-goal rating (Section 5), home practice assigned, next-session focus. Submitting the note is what moves the booking from `pending_review → completed` for providers — this guarantees the data that powers progress charts. Keep it under 2 minutes on mobile or providers won't do it: chips, sliders, voice-to-text field.

### 4.2 Home program (new)
Providers assign practice tasks (title, instructions, frequency per week, optional demo video link). Parent sees a per-child checklist; completions feed the progress view; the nudge scheduler sends gentle reminders ("3 of Aarav's practice tasks open this week"). Streaks shown softly — encourage, never guilt.

### 4.3 Summaries and nudges
- Post-session push + in-app card: note summary, next steps, "Book next session" CTA pre-filled with the same slot next week (or auto-handled by the recurring rule).
- Weekly parent digest (push + in-app): sessions done, mood trend, practice completion, one highlight from notes.
- Existing dispute/cancellation flows unchanged; add a distinct **"Report a concern"** action (separate from disputes) that escalates to admin with priority — necessary in a child-services marketplace.

---

## 5. Progress Journey (per-child tracking)

### What exists
Daily mood logs and weekly progress notes — but only inside shadow-teacher engagements. Generalize them.

### 5.1 Goals
- Domains: Communication, Motor, Behavior, Social, Academics, Daily Living.
- A goal: title ("Uses 2-word phrases to request"), domain, baseline note, target, status (`not_started → emerging → progressing → achieved`), review date, owning provider, parent-visible always.
- Created from the assessment plan proposal (3.3) or manually by provider or parent; provider-proposed goals require parent approval (one tap).

### 5.2 Progress entries
Each session note (4.1) writes a 1–5 rating + optional comment per active goal. Mood logs (existing) and home-practice completions (4.2) are additional signals.

### 5.3 The Journey screen (parent, per child)
- Per-domain progress chart over time (goal ratings, smoothed), session attendance strip, mood trendline (reuse existing data), practice completion rate.
- **Milestone timeline:** dated cards ("First full sentence — 12 Mar"), added by provider or parent, optional photo/video **only if the evidence consent toggle is on**; media stored privately, never public.
- **Care team:** the child's providers listed with access level (`full` = goals+notes+intake, `limited` = intake only). Parent grants/revokes. Providers on the team see each other's goal progress (not private notes) — a speech therapist seeing the OT's progress is genuinely valuable and rare in the Indian market.
- **Monthly report:** auto-generated PDF (child summary, goals movement, attendance, provider note highlights) with a share action — download, or an expiring read-only link for schools/doctors. Report generation is a good premium feature (Section 7).

### What stays free
Goals, ratings, charts, mood, home program — free. Tracking is the habit loop that produces rebookings, which is where commission revenue lives. Paywall exports and advanced reports, not the loop itself.

---

## 6. Professional onboarding & practice tools

### What exists
Profile wizard, verification statuses, availability + Pro templates, earnings + payouts, Go Pro ₹499/month, centre roster/services.

### 6.1 Branched onboarding
One wizard, branching by type: shadow teacher (school experience, inclusive-experience flag, travel radius), therapist (qualifications, assessment fee, modalities), trainer (coaching sub-type, batch sizes, demo policy), doctor (registration number, consult fee, document-upload note), centre (existing setup wizard unchanged). Add a profile **completeness meter** with the honest motivator: "Complete profiles get shown first." Incomplete mandatory fields block go-live (payment activation already gates this).

### 6.2 Verification tiers (trust + revenue)
- **Verified** (exists): documents reviewed by admin — free.
- **Trusted** (new): identity + background check via a third-party provider, one-time fee (suggest ₹999, configurable in admin settings), distinct badge, search-filterable. For a special-needs child marketplace this badge will convert — both for parents filtering and professionals buying.

### 6.3 My Clients (new)
A provider-side roster of children they actively work with (derived from bookings + care-team membership): intake card, their goals for this child, session history, note composer, package balance. This turns includly from a lead-gen site into the provider's lightweight practice-management tool — the real reason they'll keep paying for Pro.

### 6.4 Group sessions & workshops (new)
Providers/centres create capacity-limited group offerings (social-skills group, parent training workshop, art batch): schedule, capacity, price per seat, online/in-person. Booking checks capacity atomically. Group sessions raise the provider's effective hourly rate and give the platform commission on multiple seats per hour.

### 6.5 Pro tier — deepen the value
Keep ₹499/month and the live-EXISTS gating. Pro adds: lower commission (e.g., 15% → 10%, admin-configurable), schedule templates (exists), intro video on profile, analytics (views→unlocks→bookings funnel, search keywords), priority placement rotation among equal match scores, branded monthly progress reports (their logo on the PDF), instant payout option. Non-Pro keeps the existing amber upgrade card.

### 6.6 Featured placement (platform revenue)
₹199/week city+specialty boost, clearly labeled "Featured", capped at 2 per results page so organic trust isn't destroyed. Admin-configurable price.

---

## 7. Revenue model summary (additions in bold)

| Stream | Who pays | Mechanics |
|---|---|---|
| Contact unlocks ₹99 / ₹499-30d | Parent | Exists |
| ₹49 per-booking fee | Parent | Exists |
| Session passes / credits | Parent | Exists |
| Matching fee (admin-set) | Parent | Exists — now all specialties |
| **Includly Family ₹299/month** | Parent | 2 unlocks/mo included, PDF reports + share links, priority matching, multi-child. Core tracking stays free. |
| Commission % per specialty | Professional | Exists — **lower for Pro** |
| Go Pro ₹499/month | Professional | Exists — benefits deepened (6.5) |
| **Trusted badge ₹999 one-time** | Professional | Background check pass-through + margin |
| **Featured placement ₹199/week** | Professional | Labeled, capped |
| **Packages & group sessions** | Parent→Professional | Same commission, collected upfront — improves GMV per relationship |

---

## 8. Privacy, consent & safeguarding (non-negotiable)

- DPDP Act 2023 treats under-18 data as children's data: verifiable parental consent (Section 1), purpose limitation, **no tracking/behavioral monitoring/targeted ads** based on child data.
- Data minimization to providers: intake card only, only after an accepted booking or care-team grant; provider never sees parent contact outside the unlock rules that already exist.
- Audit log of child-profile views, visible to the parent.
- Media evidence: private storage, consent-gated, parent can delete any item; deletion cascades.
- Safeguarding: chat stays on-platform pre-booking (existing unlock model already encourages this — keep it), "Report a concern" priority escalation, Trusted-badge background checks, OTP session verification (exists) doubles as presence proof.
- Export & erase: parent can export a child's data (JSON + PDF) and delete the child profile.

---

## 9. Data model additions (Drizzle / PostgreSQL)

```ts
// children
id uuid pk, parentUserId fk users.id, displayName text, dob date,
gender text null, languages text[], schoolType text, grade text null,
conditions text[], diagnosisStatus text, goalsAreas text[],
careNotes jsonb,            // calming, triggers, communicationMode, favorites
budgetBandInr int4range null, preferredModes text[],   // home|centre|online
consent jsonb,              // {intakeShare:bool, media:bool, reports:bool, consentedAt}
createdAt, updatedAt

// child_goals
id pk, childId fk, providerId fk professional_profiles.id null,
domain text, title text, baselineNote text, target text,
status text default 'not_started', reviewDate date null,
approvedByParent bool default false, createdAt

// goal_progress_entries
id pk, goalId fk, bookingId fk null, rating int (1-5),
note text null, createdAt

// session_notes
id pk, bookingId fk unique, providerId fk, childId fk,
workedOn text[], summary text, homePractice text null,
nextFocus text null, createdAt

// home_program_tasks (+ completions)
id pk, childId fk, assignedByProviderId fk, title text,
instructions text, frequencyPerWeek int, videoUrl text null,
status text default 'active'
home_task_completions: id pk, taskId fk, completedAt, byParentUserId fk

// recurring_booking_rules
id pk, childId fk, parentUserId fk, professionalId fk,
weekdays int[], startTime time, slotDurationMinutes int,
startDate date, endDate date null, remainingSessions int null,
paymentMode text,           // per_session | package | weekly_batch
packagePurchaseId fk null, active bool default true

// service_packages (+ purchases)
id pk, professionalId fk null, centreId fk null, serviceId fk null,
name text, sessionCount int, priceInr int, validityDays int, active bool
package_purchases: id pk, packageId fk, parentUserId fk, childId fk,
remainingSessions int, validUntil date, paymentId fk

// care_team_members
childId fk, professionalId fk, accessLevel text, grantedAt, pk(childId, professionalId)

// group_sessions (+ enrollments)
id pk, professionalId fk null, centreId fk null, title text,
capacity int, priceInrPerSeat int, mode text, schedule jsonb, active bool
group_enrollments: id pk, groupSessionId fk, childId fk, parentUserId fk,
paymentId fk, status text

// milestones
id pk, childId fk, title text, date date, addedByRole text,
mediaUrl text null, createdAt

// child_profile_views (audit)
id pk, childId fk, viewerProfessionalId fk, context text, viewedAt

// changes to existing tables
session_bookings: + childId fk, + bookingType text ('regular'|'assessment'|'demo'|'group'|'consult'),
                  + recurringRuleId fk null, + packagePurchaseId fk null, + bookingGroupId uuid null
match_requests (existing shadow-teacher table): + specialty text
availability_slots: + mode text default 'in_person'
```

Atomicity rules: package decrement and group-capacity check use the same `db.transaction()` + conditional-UPDATE pattern as session credits.

---

## 10. New / changed API routes

```
POST   /api/children                    create child (consent payload required)
GET    /api/children                    list my children
GET    /api/children/:id               full profile (parent) / intake card (provider w/ access)
PUT    /api/children/:id
DELETE /api/children/:id               erasure cascade
GET    /api/children/:id/journey       goals + entries + mood + attendance (chart payload)
GET    /api/children/:id/report?month= PDF generation (Family/Pro gated)
POST   /api/children/:id/care-team     grant/revoke provider access
GET    /api/children/:id/audit         profile-view log

POST   /api/goals                       (+ PUT /api/goals/:id, parent approve action)
POST   /api/session-notes               provider, on session_ended; writes goal entries
POST   /api/home-tasks  /complete

POST   /api/recurring-rules             (+ PUT cancel; scheduler materializes bookings)
POST   /api/packages                    provider creates
POST   /api/packages/:id/purchase       Razorpay/Stripe → package_purchases
POST   /api/group-sessions  /enroll

GET    /api/professionals?childId=      adds matchScore to existing search
POST   /api/match-requests              now takes specialty (generalized matching)
GET    /api/me/clients                  provider roster (My Clients)
POST   /api/verification/trusted        initiate paid background check
```

Booking endpoint (`POST /api/sessions/book` or V2 equivalent) accepts `childId`, `bookingType`, optional `packagePurchaseId`; intake card exposed on the provider booking-detail response post-acceptance.

---

## 11. Build order

**Phase 1 — Personalization core (build first):** children table + onboarding wizard, child-scoped bookings, intake share on acceptance, personalized home with match score + generalized Get Matched, recurring booking rules + scheduler. *Rationale: every later feature depends on `childId`; recurring rules immediately lift booking volume.*

**Phase 2 — Progress & loop:** session notes with goal ratings, goals + Journey screen (fold existing mood logs in), home program + nudges, weekly digest, "Report a concern."

**Phase 3 — Revenue depth:** packages, group sessions, Trusted badge, deepened Pro (lower commission, analytics, My Clients polish), monthly PDF report + share link, Includly Family plan, featured placement.

Each phase is shippable alone. Suggested Claude Code workflow: commit this file as `docs/V2_SPEC.md`, then prompt per phase — "Read docs/V2_SPEC.md. Implement Phase 1, starting with the Drizzle schema in Section 9 and migrations, then the children API routes, then the onboarding wizard UI."

---

## 12. Metrics that tell you it's working

Activation: % of new parents completing a child profile, time-to-first-booking. Retention: rebook rate within 14 days, weekly active families, recurring-rule adoption, provider note-completion rate (target >85% — it powers everything). Revenue: package attach rate, Pro conversion and churn, Trusted-badge uptake, GMV per child per month. Trust: report-a-concern volume and resolution time, audit-log views (parents checking = parents trusting).

---

## 13. Navigation & Information Architecture redesign

Replit-generated apps share a predictable set of navigation defects, and includly shows the classic symptoms: one desktop-style top navbar stretched across every role, key actions buried behind the wrong pages, inconsistent back behavior, dead-end empty states, and no persistent context (a parent navigating for *which child?*). This section is a full IA replacement, designed mobile-first because your users are overwhelmingly on phones and you're heading to the Play Store, where a bottom-tab app shell is the expected pattern.

### 13.1 Principles

One app shell, role-scoped content. A single `<AppShell>` renders a top bar plus a bottom tab bar on mobile (`< md` breakpoint) and a collapsible left sidebar on desktop (`>= md`) — driven by one typed `navConfig` per role, which is also the single source of truth for route guards. Maximum five bottom tabs per role; everything else lives behind the top-bar avatar menu or inside a tab's own pages. Tabs are *places*, flows are *stacks*: detail screens (a profile, a booking, a goal) open as stack pages with a back chevron and title in the top bar, never as a sixth nav destination. Icon + short label always (never icon-only — clearer for stressed parents and survives Telugu/Hindi localization). Every empty state ends in exactly one CTA, never a blank page.

### 13.2 IA per role

**Logged-out (public).** Top bar: logo, Find Specialists, How it works, Pricing, For Professionals, and a single primary "Get started" button (login link secondary). Mobile collapses to a sheet menu. Public search and professional profiles stay browsable (contact blurred, as today); any gated action — unlock, book, message — routes to auth with `?next=` so the user lands back exactly where they were. Footer carries SEO directories: by specialty, by city.

**Parent — bottom tabs (5):**
1. **Home** — the Care Plan feed (Section 2)
2. **Explore** — search + Get Matched entry
3. **Bookings** — upcoming / past / recurring rules
4. **Journey** — per-child progress (Section 5)
5. **Inbox** — message threads; notification bell sits in the top bar

Top bar (parent surfaces): **child switcher chip** on the left (avatar + first name, opens a bottom sheet to switch or add a child — selection persists app-wide and scopes Home, Journey, and booking defaults), screen title center, bell + avatar right. Avatar menu (sheet): Children & profiles, Plans & payments, Account settings, Help & support, Logout.

**Professional — bottom tabs (5):**
1. **Today** — dashboard: stats, today's sessions, pending requests
2. **Calendar** — availability + booked slots in one view
3. **Clients** — My Clients roster (Section 6.3)
4. **Inbox**
5. **Earnings** — balance, history, payout requests

Avatar menu: View public profile, Edit listing, Availability templates, Pro plan & billing, Settings, Help.

**Centre admin — bottom tabs (5):** Overview, Bookings, Roster, Services, Inbox. Avatar menu: Centre profile, Cancellation policy, Billing, Settings. (Centres are often managed from a desktop — the same config renders as the sidebar there, so nothing extra to build.)

**Admin.** Stays a desktop-first left-sidebar layout with the existing tabs (Users, Professionals, Parents, Centres, Bookings, Payments, Settings). Don't spend mobile-polish effort here.

### 13.3 Route map (Wouter)

```text
# Public
/                       landing
/search                 public search (filters in URL query)
/p/:slug                professional profile        /centres/:slug
/pricing  /how-it-works /login  /signup

# Onboarding
/onboarding             role selection (post-signup)
/onboarding/child       parent wizard (Section 1)
/onboarding/pro/*       professional branched wizard (Section 6.1)
/onboarding/centre/*    existing centre setup wizard

# Parent shell
/home
/explore                /explore/match            (Get Matched flow)
/bookings               /bookings/:id             /bookings/:id/reschedule
/journey                /journey/goals/:goalId    /journey/report
/inbox                  /inbox/:threadId
/children/:id/edit      /account  /account/plans  /account/payments
/notifications

# Professional shell
/pro/today  /pro/calendar
/pro/clients            /pro/clients/:childId
/pro/inbox/:threadId?   /pro/earnings
/pro/profile  /pro/pricing  /pro/packages  /pro/groups

# Centre shell:  /centre/overview|bookings|roster|services|inbox|settings
# Admin shell:   /admin/*  (existing tabs)
```

Keep a **legacy redirect map** (old Replit paths → new paths) mounted before the 404 so existing links, bookmarks, and any indexed URLs keep working.

### 13.4 Implementation sketch

```ts
// nav/config.ts — single source of truth
type Role = 'parent' | 'professional' | 'centre_admin' | 'admin';
type NavItem = {
  label: string;            // short, localizable key
  icon: LucideIcon;
  path: string;             // tab root
  match: (loc: string) => boolean;   // active-state test incl. stack pages
  badge?: 'unreadMessages' | 'pendingRequests';
};
export const NAV: Record<Role, NavItem[]> = { /* per 13.2 */ };
```

```tsx
// AppShell.tsx — wraps the authed <Switch>
<div className="flex h-dvh flex-col">
  <TopBar />                       {/* title | child switcher | bell | avatar */}
  <main className="flex-1 overflow-y-auto">{children}</main>
  <BottomNav className="md:hidden" />          {/* shadcn-styled, h-16, safe-area pb */}
  <SideNav className="hidden md:flex" />       {/* same NAV config */}
</div>
```

Guards compose around routes: `RequireAuth` (else `/login?next=…`), `RequireRole` (else redirect to that user's shell root — never render another role's shell), and `RequireChildProfile` on parent routes (no child yet → `/onboarding/child`, skippable once). Post-login landing: parent → `/home` (or child wizard), professional → `/pro/today` (or onboarding if listing incomplete / payment not activated), centre_admin → `/centre/overview` (or setup wizard), admin → `/admin/users`. Implement with Wouter's `useLocation` + a `<Redirect>` helper; there is no Outlet in Wouter, so the shell simply wraps the role's `<Switch>`.

Behavior details that make it feel native rather than like a website:
- **Active state** via each item's `match()` so stack pages highlight their parent tab (e.g., `/bookings/123` keeps Bookings lit).
- **Per-tab scroll restoration**: store scroll position keyed by tab root in a small context; restore on tab return.
- **Back** = browser/Android back. Stack pages show a top-bar chevron that calls `history.back()`; tab switches replace rather than push so back never ping-pongs between tabs. Mid-payment/booking flows intercept back with a confirm sheet.
- **Badges** from React Query (`unreadCount`, `pendingRequests`) with invalidation on push events — same channels the bell uses.
- **Modal vs page**: on mobile, flows (booking, unlock, package purchase) are full pages; on desktop they render in shadcn `Dialog`/`Drawer` from the same components.
- **Deep links** from push notifications resolve through the same router (`/bookings/:id`, `/inbox/:threadId`), which also makes them work unchanged inside the future Play Store wrapper (TWA/Capacitor).

### 13.5 Accessibility & localization

44px minimum touch targets on all nav controls; `aria-current="page"` on the active tab; visible focus rings; respects `prefers-reduced-motion` (no animated tab transitions when set). Labels come from a strings file from day one — even before translation ships, this forces short, unambiguous labels and makes Telugu/Hindi a config change, not a refactor.

### 13.6 Migration plan & acceptance checklist

Two Claude Code passes. **N1 — shell + plumbing:** build `navConfig`, `AppShell`, `TopBar`, `BottomNav`, `SideNav`, guards, post-login redirects, and the legacy redirect map; mount existing pages under the new routes without redesigning them. **N2 — surface restructure:** reorganize each role's pages to match the tab IA (e.g., merge availability + bookings into Calendar; move payments under Account), add child-switcher scoping, badges, scroll restoration, and empty-state CTAs.

Done means every checkbox passes:
- [ ] Every screen reachable in ≤ 2 taps from a tab root; nothing orphaned
- [ ] Hard refresh works on every route (SPA fallback configured on the host)
- [ ] Android/browser back never exits the app unexpectedly or loses a payment flow without confirmation
- [ ] No role can ever render another role's shell or tabs (guard test per role)
- [ ] Active tab correct on every stack page; per-tab scroll restored
- [ ] All legacy URLs 301/redirect to new equivalents; zero 404s from old links
- [ ] Badges update live on new message / new booking request
- [ ] Child switcher persists across tabs and app restarts (localStorage)
- [ ] Touch targets ≥ 44px; `aria-current` present; works with screen reader focus order

**Suggested Claude Code prompt (run on Fable 5):** "Read docs/V2_SPEC.md Section 13. Implement pass N1 exactly: create nav/config.ts, the AppShell with TopBar/BottomNav/SideNav, RequireAuth/RequireRole/RequireChildProfile guards, post-login redirects, and a legacy route redirect map. Do not redesign page internals yet. Then run the app and verify the acceptance checklist items that apply to N1."
