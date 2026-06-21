---
name: pnpm monorepo dependency removal
description: uninstallLanguagePackages targets the workspace root, not a specific artifact package; remove artifact-scoped deps with a filtered pnpm command
---

In this pnpm monorepo, dependencies are declared per-artifact (e.g. `artifacts/sensei-link/package.json`), not at the root. The `uninstallLanguagePackages({ language: "nodejs", packages: [...] })` package-management tool reports success but operates at the **workspace root**, so it does NOT remove a dependency that is declared in an artifact's `package.json` — the line, lockfile entry, and `node_modules` all remain.

**Why:** Removing `react-mobile-picker` (declared in the sensei-link artifact) via `uninstallLanguagePackages` returned success:true but left it fully present. Verifying `package.json` + `pnpm-lock.yaml` afterward revealed it was untouched.

**How to apply:** To remove a dependency declared in `artifacts/<x>/package.json`, run `pnpm --filter @workspace/<x> remove <pkg>` directly (it updates the artifact package.json + lockfile, reboots nothing — restart the artifact workflow yourself). The same root-vs-artifact caveat likely applies to installs; verify the target `package.json` after using the package-management tool. Always confirm removal with `rg react-... package.json pnpm-lock.yaml` (expect no matches).
