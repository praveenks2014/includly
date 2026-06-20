---
name: EngagementProgress write-gating
description: The shared logs/goals/trends component only gates the "ended" status; every call site must add its own pending-status gate.
---

# EngagementProgress write-gating split

`EngagementProgress` (shared logs/goals/trends surface) only suppresses write
controls when `active.status === "ended"` (read-only banner; hides Post Update,
Add Goal, goal toggle). It does NOT gate `pending_start` /
`pending_teacher_acceptance`.

**Why:** The pending-status gate lives at each call site, not in the shared
component. `ShadowTeacherTab` blocks logs/goals/trends/payments for pending
statuses via `pendingStartDisabledTabs` + `visibleStTab` (disabled tabs forced to
"overview"). When the same component was reused in the parent `ProgressTab`, it
initially bypassed that gate and exposed pre-start writes — a real regression
caught in review.

**How to apply:** Any NEW consumer of `EngagementProgress` (or any change to an
existing one) must itself prevent reaching the component's write views for
`pending_start` / `pending_teacher_acceptance` (e.g. early-return an "Available
once the engagement starts" state). Do not assume the shared component handles
pending statuses — it only handles `ended`. Backend write endpoints do NOT yet
enforce these lifecycle rules, so the frontend gate is the only guard.
