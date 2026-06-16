import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useSelectedChild, CHILD_PROFILE_SKIP_KEY } from "@/contexts/SelectedChildContext";

interface RequireChildProfileProps {
  children: React.ReactNode;
}

export function RequireChildProfile({ children }: RequireChildProfileProps) {
  const { childProfiles, childrenLoading, childrenFetching } = useSelectedChild();
  const [, setLocation] = useLocation();

  const skipped = sessionStorage.getItem(CHILD_PROFILE_SKIP_KEY) === "1";
  const stillLoading = childrenLoading || childrenFetching;
  const hasNoChildren = !stillLoading && childProfiles.length === 0;

  useEffect(() => {
    if (hasNoChildren && !skipped) {
      setLocation("/onboarding/child", { replace: true });
    }
  }, [hasNoChildren, skipped, setLocation]);

  if (stillLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-teal-600" size={24} />
      </div>
    );
  }

  if (hasNoChildren && !skipped) {
    return null;
  }

  return <>{children}</>;
}
