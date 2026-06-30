---
name: api-client-react rebuild requirement
description: After editing api.schemas.ts or api.ts in lib/api-client-react, tsc uses dist/.d.ts via project references — must rebuild to see changes in type checks.
---

## Rule
After any edit to `lib/api-client-react/src/generated/api.schemas.ts` or `api.ts`, run:

```
pnpm --filter @workspace/api-client-react exec tsc -p tsconfig.json
```

This regenerates `lib/api-client-react/dist/*.d.ts`.

**Why:** The package `tsconfig.json` has `"composite": true, "emitDeclarationOnly": true, "outDir": "dist"`. The root workspace `tsconfig.json` references this package via `"references"`. TypeScript project references consume the compiled `dist/*.d.ts`, not the source, so TS type checks in consumer artifacts (e.g. sensei-link) see stale types until the package is rebuilt.

**How to apply:** Any time you add/rename/remove a field from `ProfessionalProfile`, `UpdateProfessionalProfileBody`, `CreateProfessionalProfileBody`, or any other type in the api-client-react generated files, rebuild immediately before running `tsc --noEmit`. Vite (runtime) reads from `./src/index.ts` via the `exports` field so the running app stays correct without a rebuild — only the type checker is affected.
