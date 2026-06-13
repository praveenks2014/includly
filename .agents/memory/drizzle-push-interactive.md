---
name: Drizzle push interactive prompt
description: drizzle-kit push detects potential column renames and asks interactively even with --force; the reliable path is direct SQL DDL
---

When running `drizzle-kit push` in this project, adding a new column whose name is similar to an existing column (e.g. adding `gender` when `diagnosis_tags` exists) triggers an interactive "is this a rename?" prompt. Even `--force` doesn't skip it — it hangs waiting for stdin.

**Rule:** For any schema migration, apply DDL directly via `executeSql` in code_execution (or psql) rather than relying on `drizzle-kit push`. Confirm with the user before running anything.

**Why:** The interactive prompt cannot be reliably bypassed in this Replit environment. Direct SQL is deterministic and shows the user exactly what will run.

**How to apply:**
1. Show the user the exact SQL (ADD COLUMN, ADD CONSTRAINT, etc.) before executing.
2. Confirm it is additive only (no DROP COLUMN, no ALTER COLUMN TYPE) unless explicitly approved.
3. Run orphan-guard UPDATEs before adding FK constraints.
4. Backfill data (e.g. old column → new column) after new columns exist.
5. After DDL is applied, `drizzle-kit push` can still be used to reconcile minor drifts (it won't try to drop columns by default).
