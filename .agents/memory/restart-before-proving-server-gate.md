---
name: A running Node workflow can silently keep serving pre-edit code
description: Clean logs and a passing typecheck after editing a query/gate are not proof the gate is live — the dev process must be restarted and re-tested empirically before trusting a security-critical change.
---

After editing server-side query logic that gates sensitive behavior (e.g. adding a `WHERE`/`EXISTS` clause to a search/matching query for a trust & safety fix), "the workflow logs look clean" and "typecheck passes" are necessary but not sufficient proof the new code is actually serving requests. A long-running dev workflow process can keep an old in-memory module/query around and continue answering with pre-edit behavior until it is explicitly restarted.

**Why:** During a live-DB proof of a search-exclusion gate, the first restart+retest still returned the old (pre-fix) query results. Only a second, fresh restart made the gate visibly take effect. Trusting "logs are clean" alone would have shipped an unenforced security gate while looking verified.

**How to apply:**
- For any change to a server-side authorization/visibility gate, always: (1) restart the workflow, (2) construct a concrete before/after case (e.g. insert a synthetic non-compliant row, confirm it's excluded; make it minimally compliant, confirm inclusion), (3) hit the real endpoint/query and check the actual result set — not just absence of errors.
- If the very first post-restart test doesn't show the expected behavior change, don't assume the code is wrong — restart again before deep-diving, since a stale process is a common false negative.
- Clean up any synthetic rows/test data immediately after the proof to avoid polluting the dev DB.
