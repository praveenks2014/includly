import { useLocation, Link } from "wouter";
import { useGetMe, useGetMyProfessionalProfile, getGetMyProfessionalProfileQueryKey } from "@workspace/api-client-react";
import { NAV, SHELL_ROOT, type Role, type NavItem } from "@/nav/config";
import { useSelectedChild } from "@/contexts/SelectedChildContext";
import { UserCircle2 } from "lucide-react";

export function SideNav() {
  const [loc] = useLocation();
  const { data: me } = useGetMe();
  const role = me?.role as Role | undefined;

  const { data: proProfile } = useGetMyProfessionalProfile({
    query: { queryKey: getGetMyProfessionalProfileQueryKey(), enabled: role === "professional" },
  });

  const { selectedChildId } = useSelectedChild();

  if (!role || role === "admin") return null;
  const allTabs = NAV[role].filter(
    (item) => !item.specialtyFilter || proProfile?.specialty === item.specialtyFilter,
  );
  const primaryTabs = allTabs.filter((item) => !item.mobileHidden);
  const secondaryTabs = allTabs.filter((item) => item.mobileHidden);
  const shellRoot = SHELL_ROOT[role];
  const showChildProfile = role === "parent" && selectedChildId != null;

  const renderItem = (item: NavItem) => {
    const active = item.match(loc);
    const Icon = item.icon;

    if (item.comingSoon) {
      return (
        <div
          key={item.path}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-300 cursor-default select-none"
          style={{ minHeight: 44 }}
        >
          <Icon size={18} strokeWidth={1.8} />
          <span className="flex-1">{item.label}</span>
          <span className="text-[10px] font-medium bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full leading-none">
            Soon
          </span>
        </div>
      );
    }

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
  };

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
        {primaryTabs.map(renderItem)}
        {secondaryTabs.length > 0 && (
          <div className="my-3 border-t border-border" />
        )}
        {secondaryTabs.map(renderItem)}
        {showChildProfile && (
          <>
            {secondaryTabs.length === 0 && <div className="my-3 border-t border-border" />}
            <Link
              href={`/children/${selectedChildId}/profile`}
              replace
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                loc.startsWith("/children")
                  ? "bg-teal-50 text-teal-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
              style={{ minHeight: 44 }}
            >
              <UserCircle2 size={18} strokeWidth={loc.startsWith("/children") ? 2.5 : 1.8} />
              Child Profile
            </Link>
          </>
        )}
      </nav>
    </aside>
  );
}
