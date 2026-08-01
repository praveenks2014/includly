---
name: Windows sandbox vite build blocked by missing native optionals
description: vite build fails repeatedly on "Cannot find module" for rollup/esbuild/lightningcss/tailwindcss-oxide native binaries in this Windows sandbox; fix is local-only, don't commit it.
---

`pnpm-lock.yaml` was generated against Replit's Linux container, so platform-specific
optional dependencies for win32 are pruned from it. Running `vite build` in this local
Windows sandbox fails in sequence (fix one, hit the next) on:

1. `Cannot find module '@rollup/rollup-win32-x64-msvc'`
2. `Cannot find module '@esbuild/win32-x64'`
3. `Cannot find module '../lightningcss.win32-x64-msvc.node'`
4. `Cannot find native binding` from `@tailwindcss/oxide`

**Why:** each of rollup/esbuild/lightningcss/tailwindcss-oxide ships per-platform native
binaries as `optionalDependencies`; pnpm's lockfile only resolved the Linux ones (Replit's
platform), so none of the win32 variants are installed here.

**How to apply:** install each missing win32 binary explicitly, pinned to the exact version
the offending package already resolved to (check via `npm view <pkg>@<version>
optionalDependencies --json | grep win32` to get the right sibling package name):
```
pnpm add -w -D @rollup/rollup-win32-x64-msvc@<rollup's version>
pnpm add -w -D @esbuild/win32-x64@<esbuild's version>
pnpm add -w -D lightningcss-win32-x64-msvc@<lightningcss's version>
pnpm add -w -D @tailwindcss/oxide-win32-x64-msvc@<oxide's version>
```
This unblocks `vite build` enough to get a real bundle-size measurement locally.

**Do NOT commit the resulting `package.json`/`pnpm-lock.yaml` changes.** These are win32-only
packages; Replit's Linux container doesn't need them and installing them there would either
fail outright or sit as dead weight. Revert those two files (`git checkout -- package.json
pnpm-lock.yaml`) once the local build/measurement is done — keep only the actual source
changes you were building, not this local unblock.
