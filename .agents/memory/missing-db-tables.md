---
name: Missing DB tables pattern
description: How to detect and fix tables defined in Drizzle schema but absent from the actual DB
---

## The rule
When a route fails with `Failed query: select ... from "table_name"`, the table is missing from the DB. drizzle-kit push is interactive and blocks in scripts; use raw `psql $DATABASE_URL` heredoc instead.

## How to detect
1. `psql $DATABASE_URL -c "\dt"` → list actual DB tables
2. `grep -rh "pgTable(" lib/db/src/schema/*.ts | grep -oP '"\\w+"'` → list schema-defined tables
3. Diff the two lists; anything in schema but not in DB must be created

## How to apply
Write `CREATE TABLE IF NOT EXISTS` + `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` statements matching the Drizzle schema. Run as a psql heredoc. Seed lookup tables (like commission_rates) in the same script with `INSERT ... ON CONFLICT DO NOTHING`.

**Why:** Drizzle migrations in this project were not applied after schema additions — the DB was created once with an older snapshot and never resynced. Will recur as new features add tables.
