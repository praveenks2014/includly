---
name: lib/db declaration staleness after schema edits
description: Why api-server tsc --noEmit shows stale/missing fields on drizzle table types after editing lib/db schema files
---

`@workspace/db`'s package.json `exports` map points at `./src/index.ts`, which suggests
consumers always see live source. In practice they don't: `lib/db/tsconfig.json` has
`composite: true` + `emitDeclarationOnly: true`, and consumer packages (e.g. api-server)
reference it via TS project references. TS resolves those cross-project imports through
the emitted `dist/**/*.d.ts` files, not the source — so editing a schema file (new columns,
new exported table) has no effect on consumer typecheck results until you regenerate the
declarations.

**Why:** Composite project references redirect to declaration output by default in this
repo's tsconfig setup, so `lib/db/dist/*.d.ts` can silently go stale relative to `src/`.

**How to apply:** After ANY edit to `lib/db/src/schema/**` (new columns, new tables, new
exports), run `pnpm --filter @workspace/db exec tsc -p tsconfig.json` to regenerate
`dist/**/*.d.ts` BEFORE typechecking or debugging "property does not exist" / "has no
exported member" errors in consumer packages (api-server, etc). This is the same class of
issue as the existing `api-client-react-rebuild.md` note, just for the db package.
