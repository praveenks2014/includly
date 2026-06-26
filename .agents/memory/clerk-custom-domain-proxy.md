---
name: Clerk custom domain proxy pattern
description: How to route all Clerk traffic through own domain when custom FAPI is unreachable or CNAME is broken
---

## The pattern

Use `proxyUrl` on `<ClerkProvider>` + a server-side proxy middleware mounted at that path.
Do NOT use `clerkJSUrl` — it does not exist as a public prop in @clerk/react v6.4.5 (internal name is `__internal_clerkJSUrl`).

```tsx
<ClerkProvider
  publishableKey={clerkPubKey}
  proxyUrl={import.meta.env.PROD ? `${window.location.origin}/api/__clerk` : undefined}
>
```

`window.location.origin` evaluated at render time — works on any domain without hardcoding.

## Server-side proxy critical detail

When the proxy middleware receives `/npm/...` requests from Clerk JS loading:
- **Do NOT strip `/npm`** before forwarding to the FAPI CDN
- `clerk.includly.in` serves assets at `/npm/...` (same path)
- Wrong: `fetchProxy(FAPI + path.replace(/^\/npm/, ""), ...)` → 404
- Correct: `fetchProxy(FAPI + path, ...)` → 200

## Server-side JWT verification

Use `@clerk/backend`'s `verifyToken({ secretKey })` — fetches JWKS from `api.clerk.com`
(the Clerk Backend API), NOT from the custom FAPI domain. This makes JWT verification
work even if the custom FAPI domain is unreachable from the production server.

```typescript
import { verifyToken } from "@clerk/backend";
const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
```

**Why:** Custom FAPI CNAMEs (like `clerk.www.includly.in`) can be deleted or become
unreachable. `api.clerk.com` is a fixed endpoint always reachable from Replit production.

## Root cause of the www.includly.in incident

`CLERK_PUBLISHABLE_KEY` (server secret, no VITE_ prefix) encoded `clerk.www.includly.in`
as its FAPI. The old requireAuth used `jose createRemoteJWKSet` pointing to that host.
When the CNAME was deleted → NXDOMAIN → all JWTs rejected → 401 for every API call.

The VITE_CLERK_PUBLISHABLE_KEY (browser key) correctly encoded `clerk.includly.in`.

**How to apply:** Any time you add auth to a new route or touch requireAuth, use
`@clerk/backend verifyToken` not `jose`. For ClerkProvider, use `proxyUrl` not `clerkJSUrl`.
