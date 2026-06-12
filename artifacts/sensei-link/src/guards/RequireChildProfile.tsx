// N1 stub — always passes through.
// V2 Phase 1 replaces this with a real check: GET /api/children →
// if the array is empty, replace-navigate to /onboarding/child (skippable once).

interface RequireChildProfileProps {
  children: React.ReactNode;
}

export function RequireChildProfile({ children }: RequireChildProfileProps) {
  return <>{children}</>;
}
