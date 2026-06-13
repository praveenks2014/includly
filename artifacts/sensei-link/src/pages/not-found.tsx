import { Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { SHELL_ROOT, type Role } from "@/nav/config";
import { AlertTriangle, Home } from "lucide-react";

export default function NotFound() {
  const { data: me } = useGetMe();

  const role = me?.role as Role | undefined;
  const homeHref = role ? (SHELL_ROOT[role] ?? "/") : "/";
  const homeLabel = role ? "Go to my home" : "Go to homepage";

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
        <AlertTriangle className="h-7 w-7 text-amber-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        This page doesn't exist or may have moved. Check the URL or head back.
      </p>
      <Link
        href={homeHref}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-700"
      >
        <Home size={16} />
        {homeLabel}
      </Link>
    </div>
  );
}
