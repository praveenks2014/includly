# Includly — Shadow Teacher Matching & Engagement Module

### Replit Agent Build Prompt

-----

## 0. Context (read first)

You are extending an existing web application called **Includly**, a marketplace that connects parents of children with special needs to professionals (shadow teachers, therapists, tutors, etc.).

- **Auth/signup already exists** (Clerk). Do NOT rebuild signup. Extend the existing user model and post-signup flow.
- **Database:** Supabase (Postgres). Add new tables, do not break existing ones.
- **Payments:** Razorpay (orders + payouts/escrow already partially wired). Reuse the existing Razorpay integration where present.
- Build a clean, mobile-responsive web UI. Keep components modular.
- **All money cuts and tier definitions must be admin-configurable** (see Section 1). Never hardcode percentages or salary numbers in business logic — read them from a settings table.

Build the modules below. A suggested build order is at the end if you want to ship incrementally.

-----

## 1. Global admin-configurable settings (build this first)

Create a single source of truth (`platform_settings` table + an Admin Settings screen) for these values. Everything else reads from here.

- `matching_fee_percent` — single percentage applied to ALL tiers (same % across every tier).
- `salary_platform_cut_percent` — percentage deducted from monthly salary before crediting the shadow teacher.
- `notice_period_days` — default 30.
- `parent_buyout_days` — default 15 (number of days’ salary a parent pays to skip the notice period when changing a shadow teacher).
- `tiers` — editable list of shadow-teacher tiers, each with: tier name, min/max monthly salary (INR), and qualification/experience/English-fluency thresholds used for auto-categorization.

Seed with these starter tiers (admin can rename/edit):

|Tier           |Description                             |Example salary band (INR/mo)|
|---------------|----------------------------------------|----------------------------|
|Budget         |Basic qualifications, minimal experience|12,000–18,000               |
|Standard       |Some special-needs experience           |18,000–28,000               |
|Premium        |Strong experience + good English fluency|28,000–45,000               |
|ABA Specialist |ABA-trained                             |45,000–65,000               |
|BCBA Specialist|BCBA-certified                          |65,000+                     |

-----

## 2. Module: Parent onboarding & needs questionnaire (progressive disclosure)

**Goal:** capture the child’s profile, then reveal ONLY the professional-request tabs the parent actually needs.

**Step A — Child profile form:**

- Child details: name (or nickname), age/date of birth, diagnosis/condition (optional, free text + optional tags like ADHD, ASD, etc.).
- Location (city + area; store lat/long if possible for distance matching later).
- Documents upload (diagnosis reports, IEP, school letters). Show a clear, visible reassurance line near the uploader, e.g. *“Your documents are private, encrypted, and shared only with professionals you choose to engage.”* Store securely in Supabase Storage with restricted access.
- “What are you looking for?” — free-text + the structured questionnaire below.

**Step B — Needs questionnaire (drives the tabs):**
Ask the parent which type(s) of support they need (multi-select). Options:

- Shadow teacher
- Therapy centre
- Tutor
- Occupational therapist
- Speech therapist
- Developmental pediatrician
- Psychologist
- Psychiatrist
- Individual sports trainer
- Individual arts trainer

**Step C — Progressive tab reveal:**
After the questionnaire, show a “Raise a Request” area where ONLY the tabs matching the parent’s selections appear. (A parent who selected only “Shadow teacher” sees only that tab.) Each tab opens a request form. **Implement the Shadow Teacher tab fully (Section 3). Scaffold the other tabs as placeholders** (“Coming soon” + a basic request form stub) so the structure is in place.

-----

## 3. Module: Shadow teacher request form (parent-facing)

When a parent opens the Shadow Teacher tab, collect:

- **School timing** (start/end time, days).
- **Gender preference** (Male / Female / No preference).
- **Hours/time needed** — which time slots the shadow teacher is required for (e.g. during school hours, after-school, specific blocks).
- **Help required** — structured checklist + free text describing what they need help with (e.g. classroom support, behavior management, note-taking, transitions, social skills).
- **Expected tier** — let the parent pick a target tier from the configurable tier list (including ABA Specialist and BCBA Specialist). Show each tier’s salary band and a short description so they understand the difference.

**Matching fee:**

- Once a tier is selected, calculate and display the matching fee = `matching_fee_percent` (from settings) applied to the tier’s base (use the tier’s salary band — confirm whether you want it on monthly salary or a flat tier base; default to one month’s salary at the lower bound of the band).
- The matching fee is collected from the parent via Razorpay at the point of confirming a match (see Section 6).

-----

## 4. Module: Shadow teacher onboarding (provider-facing)

Use the **existing signup**, then run a post-signup detail-collection flow:

1. **Gate question:** “Are you willing to work as a shadow teacher?” (Yes/No). If No, skip the shadow-teacher flow.
1. If Yes, collect:
- Location + **maximum distance willing to travel** (km).
- **Expected salary range** (INR/month).
- **Languages known** (multi-select + English fluency level: Basic / Conversational / Fluent).
- **Past experience** (years + free text; types of settings).
- **Type of kids/conditions handled** (multi-select tags).
- **Ways they can help during shadowing** — render as **toggle switches** (e.g. behavior management, academic support, note-taking, transitions, feeding/self-care support, social-skills coaching, sensory support). Store which toggles are ON.
- Qualifications / certifications (incl. ABA, BCBA).
1. **Auto tier categorization:** based on qualifications, experience, and English fluency, compute the tier using the thresholds in `platform_settings.tiers`. Store the computed tier on the profile (admin can override).
1. **Suggestive salary range:** after categorization, show the shadow teacher the suggested salary band for their tier (from settings) as guidance.

-----

## 5. Module: Matching, linking & engagement lifecycle

**Linking:** an admin or the matching flow links a shadow teacher to a child (one active engagement per child–teacher pair). Store an `engagements` record (parent, child, shadow teacher, tier, agreed monthly salary, start date, status).

**Notice period & change requests** (both create formal, tracked requests with status: pending → approved → completed):

- **Shadow teacher wants to stop:** must formally raise a “Stop Engagement” request. They serve a **1-month notice period** (`notice_period_days`). Engagement stays active until the notice completes.
- **Parent wants to change/replace the shadow teacher:** raise a “Change Shadow Teacher” request with two options:
  - (a) serve the **1-month notice period**, OR
  - (b) **pay `parent_buyout_days` (default 15) days’ salary** to end immediately.
- Surface these requests in both the parent and shadow teacher dashboards and in the Admin panel, with timestamps and computed end dates.

-----

## 6. Module: Payments

**Matching fee (parent → platform):**

- Collected via Razorpay when a match is confirmed. Amount = matching-fee calculation from Section 3.

**Monthly salary (parent → shadow teacher, via platform):**

- Parent pays the agreed monthly salary in-app through Razorpay.
- Platform deducts `salary_platform_cut_percent`, then the net amount is credited/paid out to the shadow teacher (use Razorpay payouts/escrow consistent with the existing setup).
- Show both parties a clear breakdown: gross salary, platform cut, net to teacher.
- Track payment status per month per engagement (paid / pending / overdue) and show payment history to both parties and admin.

-----

## 7. Module: Daily two-way logs (private to each engagement)

All logs are scoped to a single engagement and visible **only** to the linked parent and the linked shadow teacher for that child.

**Shadow teacher daily log (template-based form, one per day):**

- What was taught in school today.
- How the child was in school (behavior/mood).
- Feedback / areas to improve.
- Concepts that need to be re-taught at home.
- Visible only to the associated parent.

**Parent log (shared to the shadow teacher):**

- Events / things the shadow teacher should take care of.
- Areas where the child needs extra support.
- Visible only to the associated shadow teacher.

Implement as a shared timeline within the engagement, with the daily template prompting the shadow teacher each day. Keep entries timestamped and read-only once submitted (allow edit within the same day if you like).

-----

## 8. Data model (suggested tables)

- `platform_settings` (singleton: fee %, cut %, notice days, buyout days, tiers JSON)
- `children` (parent_id, profile, location, documents refs)
- `parent_requests` (child_id, professional_type, status, payload JSON — holds the per-type questionnaire answers)
- `shadow_teacher_profiles` (user_id, willing, location, travel_km, salary_range, languages, english_fluency, experience, kids_handled, help_toggles JSON, qualifications, computed_tier, admin_override_tier)
- `engagements` (parent_id, child_id, shadow_teacher_id, tier, monthly_salary, start_date, status)
- `lifecycle_requests` (engagement_id, type [stop | change], method [notice | buyout], raised_by, status, raised_at, effective_end_date)
- `payments` (engagement_id, type [matching_fee | salary], gross, platform_cut, net, month, razorpay_ref, status)
- `daily_logs` (engagement_id, author_role [teacher | parent], date, template fields / content, created_at)

-----

## 9. Acceptance criteria

- Admin can change every percentage, the notice period, the buyout days, and tier bands from one screen; all business logic reads those values live.
- Parent onboarding reveals only the request tabs matching the questionnaire answers.
- Shadow teacher tab collects all listed fields and computes a matching fee from the selected tier.
- Shadow teacher onboarding auto-assigns a tier and shows a suggested salary band.
- Stop/change requests enforce the 1-month notice OR 15-day buyout and show correct effective end dates.
- Salary payments deduct the configurable platform cut and show a clear breakdown to both sides.
- Daily logs are strictly private to the parent–teacher pair of that engagement.

-----

## 10. Suggested build order (if shipping incrementally)

1. Section 1 (admin settings + tiers) — foundation.
1. Section 4 (shadow teacher onboarding + tiering).
1. Sections 2 & 3 (parent onboarding, questionnaire, shadow teacher request).
1. Section 5 (linking + lifecycle requests).
1. Section 6 (payments).
1. Section 7 (daily logs).

Build mobile-responsive, keep components modular, and reuse existing Clerk auth, Supabase, and Razorpay wiring throughout.