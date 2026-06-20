---
name: Full buyout exit pattern
description: How the full_buyout lifecycle method works — reuse, immediate-end logic, and enum placement
---

## Rule
Full buyout reuses all existing buyout infrastructure (buyoutOrderId/buyoutFeeInr/buyoutPaymentId columns, verify-buyout-payment endpoint, scheduler). Only differences from the 15-day buyout:
- fee = full `monthlyFeeInr` (no proration)
- `effectiveEndDate` = parent-chosen date (from `endDate` body param); defaults to today
- `endedReason = "full_buyout"` (plain text column — no migration needed for this)
- if `effectiveEndDate === today`: verify handler sets `status: "ended"` directly — scheduler never sees it

**Why:** Avoid duplicating payment/verify logic; the scheduler is already parametric on `endDate`. The "immediate" split is a single `if` in `verify-buyout-payment` only.

**How to apply:**
- Any guard that checks `method === "buyout"` must be extended to `["buyout", "full_buyout"].includes(method)`
- Any place that hardcodes `endedReason: "buyout"` must branch on `method`
- Frontend banner checks on `endedReason === "buyout"` must become `["buyout","full_buyout"].includes(endedReason ?? "")`
- Migration 0025 adds `full_buyout` to `lifecycle_request_method` enum (ALTER TYPE ADD VALUE — must NOT be in a transaction)
