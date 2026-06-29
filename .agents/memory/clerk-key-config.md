---
name: Clerk key configuration — dev vs prod
description: Why CLERK_SECRET_KEY_DEV must be used in clerkMiddleware in dev; why setAuthTokenGetter must not be called on web
---

## The rule — clerkMiddleware must use CLERK_SECRET_KEY_DEV in dev

`clerkMiddleware` in `app.ts` must pass `secretKey: CLERK_SECRET_KEY_DEV` when `NODE_ENV !== "production"`:

```typescript
secretKey:
  process.env.NODE_ENV !== "production"
    ? (process.env.CLERK_SECRET_KEY_DEV ?? process.env.CLERK_SECRET_KEY)
    : process.env.CLERK_SECRET_KEY,
```

**Why:** Replit-managed Clerk provisions two secret keys. `CLERK_SECRET_KEY` is `sk_live_…` (production instance). `CLERK_SECRET_KEY_DEV` is the dev/test instance key. When `clerkMiddleware` receives `sk_live_…` in dev, it resolves JWKS from the production Clerk FAPI, but dev session cookies are issued by the dev Clerk FAPI — verification fails silently → `getAuth(req)` returns `null` → every request 401s. Debug signature: `clerkId: null, sessionId: null` with `hasCookie: true` and multiple `__session_*` cookies present.

**How to apply:** Any time the API server returns 401 in dev with valid Clerk cookies present, confirm that `secretKey: CLERK_SECRET_KEY_DEV` is wired into `clerkMiddleware` in `app.ts`.

---

## Do NOT call setAuthTokenGetter / setFetchAuthTokenGetter on web

`main.tsx` must NOT call `setAuthTokenGetter` or `setFetchAuthTokenGetter` with a Clerk token getter.

**Why:** Clerk-auth skill explicitly says these are for Expo/mobile only. On web, Clerk session cookies are sent automatically via `credentials: "include"`. Adding a Bearer token getter introduces failure modes (`window.Clerk.session` being transiently null strips auth entirely). The fix for web 401s is always in `clerkMiddleware` configuration, not the client.

**How to apply:** If `main.tsx` ever re-gains a `clerkTokenGetter` wired to `setAuthTokenGetter` / `setFetchAuthTokenGetter`, remove it.
