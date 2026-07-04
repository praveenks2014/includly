---
name: api-zod barrel export ambiguity
description: lib/api-zod's src/index.ts re-exported both generated/api (zod value consts) and generated/types (TS interfaces) with the same names, causing TS2308 ambiguous-export errors that silently blocked the package's composite build and left dist/ stale.
---

`lib/api-zod/src/index.ts` used to do `export * from "./generated/api"` (zod schema consts like `BookSessionBody`) AND `export * from "./generated/types"` (orval-generated TS interfaces with the same names). Since `tsconfig.base.json` has `noEmitOnError: true`, this ambiguity blocked `tsc` from ever emitting, so `dist/` stayed permanently stale — and TS project references then redirect consumers (api-server, sensei-link) to that stale dist during typecheck, producing confusing "missing export" errors for fields that exist fine in source and at runtime (dev servers use `exports: "./src/index.ts"` directly, unaffected).

Changing the types export to `export type *` did NOT fix it — `isolatedModules: true` still flags the ambiguity regardless of type/value distinction.

**Why:** All current consumers import these names as values only (e.g. `BookSessionBody.safeParse(req.body)`, confirmed via grep — zero `import type` usage), so the `generated/types/*` interface re-export was fully redundant.

**How to apply:** If you hit TS2308 ambiguous-export errors from this barrel, first grep consumers to confirm they only use these names as values, then simply delete the `export * from "./generated/types"` line from `lib/api-zod/src/index.ts` entirely (don't try `export type *` — it won't resolve it). Rebuild both `@workspace/api-zod` and `@workspace/api-client-react` dist afterward (`pnpm --filter <pkg> exec tsc -p tsconfig.json`) to un-stick project-reference typecheck redirection.
