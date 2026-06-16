---
name: Goal-based logging pattern
description: How child goals and 5-level prompt ratings are stored and gated in the engagement daily log system
---

## Rule
`goalRatings` (and `behaviorCounts`, `durations`, `photoKey`) are stored as JSON inside `engagement_daily_logs.content` alongside existing text fields. They are **additive** — old logs without them render correctly; the UI just skips missing fields.

**Why:** Avoids a schema migration for every new log field; log content is always serialized as-is from the validated Zod schema.

## Structure
```json
{
  "behaviorMood": "...",
  "reteachAtHome": "...",
  "goalRatings": [{ "goalId": 1, "label": "Writes name", "level": "visual_prompt" }],
  "behaviorCounts": [{ "label": "Hand raising", "count": 3 }],
  "durations": [{ "label": "Sustained focus", "minutes": 20 }],
  "photoKey": "uploads/..."
}
```

## 5-level hierarchy (enum in TeacherLogContentSchema)
`independent` → `visual_prompt` → `verbal_prompt` → `modeling` → `physical_assist`

## How to apply
- Server-side consent gate in `dailyLogs.ts` POST/PATCH: reject `photoKey` if `child.consent.media !== true`
- `child_goals` access gate: parent of child OR teacher with `active`/`notice_period` engagement on that child
- Pro dashboard engagement GET (`engagements.ts`) includes `candidateId` (LEFT JOIN on matchRequestId+professionalId), `childConsent`, `childConditions`, `childLanguages`, `childCity` — needed by EngagementTab to gate photo UI and show child snapshot
- `candidateId` comes from LEFT JOIN `shadow_match_candidates` on `match_id = match_request_id AND professional_id = prof.id`
