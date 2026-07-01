import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useGetMe, useGetMyProfessionalProfile, getGetMyProfessionalProfileQueryKey } from "@workspace/api-client-react";
import { NAV, type Role } from "@/nav/config";
import { useSelectedChild } from "@/contexts/SelectedChildContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MoreHorizontal, UserCircle2 } from "lucide-react";

export function BottomNav() {
  const [loc] = useLocation();
  const { data: me } = useGetMe();
  const role = me?.role as Role | undefined;
  const { selectedChildId } = useSelectedChild();
  const [moreOpen, setMoreOpen] = useState(false);

  const { data: proProfile } = useGetMyProfessionalProfile({
    query: { queryKey: getGetMyProfessionalProfileQueryKey(), enabled: role === "professional" },
  });

  if (!role || role === "admin") return null;
  const allTabs = NAV[role].filter(
    (item) => !item.specialtyFilter || proProfile?.specialty === item.specialtyFilter,
  );
  const primaryTabs = allTabs.filter((item) => !item.mobileHidden);
  const secondaryTabs = allTabs.filter((item) => item.mobileHidden);
  const showChildProfile = role === "parent" && selectedChildId != null;
  const showMore = secondaryTabs.length > 0 || showChildProfile;
  const secondaryActive = secondaryTabs.some((item) => item.match(loc));

  return (
    <nav
      className="md:hidden flex h-16 shrink-0 items-stretch border-t border-border bg-white"
      aria-label="Main navigation"
    >
      {primaryTabs.map((item) => {
        const active = item.match(loc);
        const Icon = item.icon;

        if (item.comingSoon) {
          return (
            <div
              key={item.path}
              className="relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-gray-300 cursor-default select-none"
              style={{ minHeight: 44 }}
            >
              <Icon size={20} strokeWidth={1.8} />
              <span>{item.label}</span>
            </div>
          );
        }

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

      {showMore && (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
                secondaryActive
                  ? "text-teal-600"
                  : "text-gray-500 hover:text-gray-700"
              }`}
              aria-current={secondaryActive ? "page" : undefined}
              style={{ minHeight: 44 }}
            >
              {secondaryActive && (
                <span className="absolute inset-x-[25%] top-0 h-0.5 rounded-full bg-teal-500" />
              )}
              <MoreHorizontal size={20} strokeWidth={secondaryActive ? 2.5 : 1.8} />
              <span>More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>More</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1 py-2">
              {secondaryTabs.map((item) => {
                const Icon = item.icon;
                const active = item.match(loc);

                if (item.comingSoon) {
                  return (
                    <div
                      key={item.path}
                      className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-gray-300 cursor-default select-none"
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
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
                      active
                        ? "bg-teal-50 text-teal-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
                    {item.label}
                  </Link>
                );
              })}
              {showChildProfile && (
                <Link
                  href={`/children/${selectedChildId}/edit`}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                >
                  <UserCircle2 size={18} strokeWidth={1.8} />
                  Child Profile
                </Link>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </nav>
  );
}
