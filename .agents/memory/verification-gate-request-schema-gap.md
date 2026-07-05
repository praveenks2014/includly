---
name: New profile dimension must be writable, not just readable, in the API spec
description: A field added only to a response schema (not the Create/Update request body schema) silently breaks any client flow that tries to set it — codegen produces no error, TS just drops the unknown key.
---

When adding a new profile dimension that gates business logic (e.g. a `vertical`/`type`/`category` field used for server-side authorization or verification rules), it is not enough to add it to the *response* schema in openapi.yaml. If it is missing from the `Create*Body`/`Update*Body` request schemas, the generated TS client silently strips the field from any `POST`/`PATCH` call — no type error, no runtime error, no log line. The server falls back to its default value, and every downstream feature gated on that field appears to work in direct API/SQL testing but is completely unreachable through the real UI flow.

**Why:** Found in the specialist-verification gate — the `vertical` field existed on the professional profile response and had backend enforcement logic, but real onboarding could never persist `vertical="therapist"` because the request body schemas never declared it. Backend + gate logic was 100% correct and passed every direct DB/API proof; the actual production bug was purely a schema-parity gap that only surfaces when tracing the real client call.

**How to apply:**
- Whenever a field participates in a request AND response shape, grep openapi.yaml for the field name and confirm it appears in every `*Body` schema that should be able to set it, not just the entity/response schema.
- After any openapi.yaml edit, run codegen (`pnpm --filter @workspace/api-spec run codegen`) then rebuild `@workspace/api-client-react`'s dist (`pnpm --filter @workspace/api-client-react exec tsc -p tsconfig.json`) so TS surfaces any now-fixed/now-broken call sites — a drop in pre-existing TS error count for the field's call sites is a good corroborating signal the fix landed.
- Don't trust "the backend gate is correct" as proof the feature works end-to-end — trace whether the client can actually set the value the gate depends on.
