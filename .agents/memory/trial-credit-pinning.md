---
name: Trial credit pinning pattern
description: How the trial session fee credit is carried over and applied safely to the first monthly salary payment
---

## Rule
The trial credit amount is **pinned to the salary payment record at first order creation** and reused on all retries. It is never recomputed from `eng.trialCreditInr` after the first attempt.

**Why:** If the parent abandons a Razorpay order and retries, `trialCreditApplied` is still false. Recomputing from `eng` would compute the same credit, but it allows a race condition where two concurrent requests could both see `trialCreditApplied = false` and create orders for potentially different amounts. Pinning to the payment record makes every order for the same month always charge the same `chargeableGross`.

## How to apply

### At `pay-salary` (order creation):
```typescript
const trialCredit = existing
  ? (existing.trialCreditInr ?? 0)         // retry: reuse what's stored
  : (!eng.trialCreditApplied && eng.trialCreditInr > 0
      ? eng.trialCreditInr : 0);            // first attempt: compute fresh
```
- Store `trialCreditInr` in the payment record insert on first attempt.
- On retry, the existing SELECT must include `trialCreditInr`.

### ₹0 path:
If `chargeableGross === 0`, skip Razorpay entirely: insert/update a `paid` payment record immediately and set `trialCreditApplied = true` on the engagement.

### At `verify-salary-payment`:
```typescript
if (updated!.trialCreditInr > 0) {
  // set trialCreditApplied = true on engagement
}
```
Uses the payment record's stored amount — not re-read from `eng`.

## Carry-over (automatic, at engagement creation)
`POST /engagements` accepts optional `matchRequestId`. When provided, fetches `match.trialFeePaidInr` with ownership check (`parentId = req.userId`) and writes it to `engagement.trialCreditInr`. No admin action needed.
