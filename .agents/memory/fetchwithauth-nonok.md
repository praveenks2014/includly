---
name: fetchWithAuth non-2xx handling
description: fetchWithAuth never throws on non-2xx; queryFns that parse json treat error bodies as success and crash array consumers
---

`fetchWithAuth` (sensei-link `src/lib/api.ts`) returns the raw `Response` and does NOT throw on non-2xx. A `useQuery` queryFn written as `fetchWithAuth(url).then(r => r.json())` therefore resolves *successfully* even on 403/500 — `data` becomes the parsed error body (an object), not the expected array. The `= []` default only applies while `data` is `undefined`; once the error body resolves, `data` is the object.

**Why:** `/api/connect/inbox` legitimately returns 403 for some parents. The unguarded HomeTab query made `threads` the error object, and `threads.reduce(...)` threw "reduce is not a function", white-screening the parent Home. The existing MessagesTab avoided this with `setThreads(Array.isArray(data) ? data : [])` + `.catch(() => {})`.

**How to apply:** Any `fetchWithAuth(...).then(r => r.json())` whose result is consumed with `.reduce`/`.find`/`.map`/`.length` must guard the shape — either check `r.ok` first or wrap with `Array.isArray(data) ? data : []` and `.catch(() => [])`. Endpoints known to reliably return arrays for the caller's role (e.g. `/api/engagements` for parents) are used unguarded elsewhere and are safe, but new consumers of role/permission-gated endpoints should guard.
