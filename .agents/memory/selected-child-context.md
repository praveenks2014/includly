---
name: SelectedChildContext pattern
description: How the selected child is managed across the parent shell — context shape, skip key, and guard behavior
---

## Rule
`SelectedChildProvider` (in `AppShell`) is the single source of truth for the active child.
`localStorage` is only the persistence layer behind it — no component reads localStorage directly.
`sessionStorage` key `CHILD_PROFILE_SKIP_KEY` (exported from the context file) gates the soft-wall guard.

## Context shape
`childProfiles: ChildResponseType[]`, `childrenLoading: boolean`, `selectedChildId: number | null`,
`selectedChild: ChildResponseType | undefined`, `setSelectedChildId: (id: number) => void`

## RequireChildProfile guard logic
1. Loading → spinner
2. No children + sessionStorage skip flag → pass through
3. No children + no skip flag → replace-navigate to /onboarding/child
4. Children exist → pass through

## How to apply
- Any page needing the active child: `const { selectedChild } = useSelectedChild()`
- After creating a child (POST /api/children): invalidate `["/children"]` query key
  (`queryClient.invalidateQueries({ queryKey: ["/children"] })`) — context auto-refreshes
- Wizard "Skip for now": `sessionStorage.setItem(CHILD_PROFILE_SKIP_KEY, "1")` then navigate to /home
