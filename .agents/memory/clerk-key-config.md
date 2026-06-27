---
name: Clerk key configuration
description: How Clerk publishable/secret keys are configured across dev preview and production for includly.in
---

# Clerk Key Configuration

## The rule
- `VITE_CLERK_PUBLISHABLE_KEY` (shared env var, NOT a secret) = `pk_live_Y2xlcmsuaW5jbHVkbHkuaW4k` — the live key encoding `clerk.includly.in`.
- In `App.tsx`, production path uses `VITE_CLERK_PUBLISHABLE_KEY`. Dev preview uses the hardcoded `DEV_CLERK_KEY` (`pk_test_...` for `choice-lion-57.clerk.accounts.dev`).
- `CLERK_SECRET_KEY` (secret) = production Clerk secret for `includly.in` instance.
- `CLERK_SECRET_KEY_DEV` (secret) = dev Clerk secret for `choice-lion-57` instance. Server `requireAuth.ts` tries prod key first, falls back to dev key.

**Why:**
- Live Clerk publishable keys are domain-locked; they encode the FAPI host directly. If the wrong key is baked into the Vite bundle, Clerk JS loads from the wrong domain (e.g. `clerk.www.includly.in` instead of `clerk.includly.in`), causing `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`.
- Vite bakes `VITE_*` vars at build time. A Replit secret with the same name as an env var overrides it silently. Previously, a `VITE_CLERK_PK` secret with the wrong `www.includly.in` key was overriding the correct env var — this caused all production deployments to use the wrong FAPI domain.
- The publishable key is public (baked into every user's browser JS), so it is safe to set it as a plain env var via `setEnvVars`.

**How to apply:**
- Always set the live publishable key as a **shared env var** (`setEnvVars`), never as a secret, to avoid silent override conflicts.
- If you see `clerk.www.includly.in` in browser errors, first check `viewEnvVars` for any `VITE_CLERK_*` secrets that might be overriding the env var.
- After changing the env var, a full redeploy is required (Vite bakes it at build time; deleting the secret without redeploying leaves the old value in the bundle).
- `CLERK_SECRET_KEY_DEV` must be the secret key for the `choice-lion-57.clerk.accounts.dev` Clerk app (get from Clerk dashboard → API Keys).
