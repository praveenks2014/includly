import { useLocation, Link } from "wouter";
import { useGetMe } from "@workspace/api-client-react";
import { NAV, type Role } from "@/nav/config";

export function BottomNav() {
  const [loc] = useLocation();
  const { data: me } = useGetMe();
  const role = me?.role as Role | undefined;

  if (!role || role === "admin") return null;
  const tabs = NAV[role];

  return (
    <nav
      className="md:hidden flex h-16 shrink-0 items-stretch border-t border-border bg-white"
      aria-label="Main navigation"
    >
      {tabs.map((item) => {
        const active = item.match(loc);
        const Icon = item.icon;
        return (
          <Link
            key={item.path}
            href={item.path}
            replace
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
              active
                ? "text-teal-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
            aria-current={active ? "page" : undefined}
            style={{ minHeight: 44 }}
          >
            {active && (
              <span className="absolute inset-x-[25%] top-0 h-0.5 rounded-full bg-teal-500" />
            )}
            <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
