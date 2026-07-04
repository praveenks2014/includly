---
name: Razorpay checkout e2e testing limits
description: Automating Razorpay's own hosted checkout iframe (contact details/OTP step) in Playwright e2e tests is not reliably possible — treat order creation + correct method/amount restriction as the testable boundary.
---

When testing a Razorpay Checkout integration end-to-end via the `testing` skill's `runTest`, the app-controlled parts (order creation with correct amount/currency, method restriction e.g. UPI-only, Test Mode ribbon showing) are reliably verifiable. But Razorpay's own "Contact details" overlay (prefilled test mobile number, "Continue" button) that gates entry to the actual payment-method screen could not be advanced by automation across repeated attempts (button click doesn't register; OTP step never reached).

**Why:** This is Razorpay's native hosted UI requiring phone verification, not part of the app's code — it behaves the same in test mode for any merchant, and Playwright cannot reliably drive it to completion in this environment.

**How to apply:** For Razorpay checkout features, scope e2e test plans to verify: (1) the UI states before payment (buttons, explainer text, correct pre/post-verification rendering), (2) that clicking pay opens Razorpay Checkout with the correct amount/currency/method restriction and Test Mode active. Don't expect to drive a full payment to completion in automated tests — verify the server-side confirm/webhook logic via code review instead, and note this boundary explicitly rather than retrying the same overlay-click approach.
