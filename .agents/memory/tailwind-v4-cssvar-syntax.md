---
name: Tailwind v4 CSS custom-property arbitrary value syntax
description: Bare `[--foo]` arbitrary-value syntax (Tailwind v3 style) silently fails to compile to valid CSS under Tailwind v4; explains "dead" max-height/origin/etc classes that look present but never apply.
---

Tailwind v3 allowed `max-h-[--my-var]` as shorthand for `max-height: var(--my-var)`. Under Tailwind v4, this bare-var-name form inside square brackets compiles to invalid CSS literally (`max-height: --my-var;`), which the browser silently drops — the property never applies, with no build error or warning.

**Why:** Discovered while fixing a shadcn/ui Radix Select dropdown that wouldn't scroll. The outer `SelectContent` had `max-h-[--radix-select-content-available-height]` (looked like a correct height cap), but it never compiled, so the popup had no height limit and could render taller than the viewport with no working scroll container. A sibling `origin-[--radix-select-content-transform-origin]` class had the same dead-CSS problem (cosmetic, animation-origin).

**How to apply:** In Tailwind v4 projects, when referencing a CSS custom property in an arbitrary value, use either the parens form `max-h-(--my-var)` or the explicit `var()` form `max-h-[var(--my-var)]` — both compile correctly. Bare `[--my-var]` does not. This bug pattern is easy to miss because the class name still *looks* right in JSX/className strings, and unrelated fixes (e.g. fixing an inner element's competing height class) can partially mask or fully expose the underlying missing cap depending on layout. When debugging "this Tailwind class doesn't seem to do anything" on a v4 project, check for this exact bare-`--var` pattern first, especially in shadcn/ui-derived components (select.tsx, context-menu.tsx, dropdown-menu.tsx, popover.tsx, etc. — anything copied from older shadcn templates written for Tailwind v3).
