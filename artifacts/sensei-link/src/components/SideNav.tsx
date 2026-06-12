import { useLocation, Link } from "wouter";
import { useClerk } from "@clerk/react";
import { useGetMe } from "@workspace/api-client-react";
import { LogOut } from "lucide-react";
import { NAV, SHELL_ROOT, type Role } from "@/nav/config";

export function SideNav() {
  const [loc, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { data: me } = useGetMe();
  const role = me?.role as Role | undefined;

  if (!role || role === "admin") return null;
  const tabs = NAV[role];
  const shellRoot = SHELL_ROOT[role];

  return (
    <aside
      className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-white"
      aria-label="Sidebar navigation"
    >
      <Link
        href={shellRoot}
        className="flex items-center gap-2 border-b border-border px-5 py-4"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600">
          <span className="text-xs font-bold text-white">In</span>
        </div>
        <span className="font-serif text-base font-semibold text-gray-900">
          Includly<span className="text-teal-500">·</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {tabs.map((item) => {
          const active = item.match(loc);
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              replace
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-teal-50 text-teal-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              aria-current={active ? "page" : undefined}
              style={{ minHeight: 44 }}
            >
              <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-4">
        <button
          onClick={() => signOut(() => setLocation("/"))}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
          style={{ minHeight: 44 }}
        >
          <LogOut size={18} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
