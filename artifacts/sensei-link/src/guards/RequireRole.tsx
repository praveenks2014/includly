import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";
import { SHELL_ROOT, type Role } from "@/nav/config";

interface RequireRoleProps {
  allow: Role[];
  children: React.ReactNode;
}

export function RequireRole({ allow, children }: RequireRoleProps) {
  const { data: me, isLoading } = useGetMe();
  const [, setLocation] = useLocation();
  const role = me?.role as Role | undefined;

  useEffect(() => {
    if (isLoading || !role) return;
    if (!allow.includes(role)) {
      setLocation(SHELL_ROOT[role] ?? "/", { replace: true });
    }
  }, [isLoading, role, allow, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-teal-600" size={24} />
      </div>
    );
  }

  if (!role || !allow.includes(role)) return null;

  return <>{children}</>;
}
