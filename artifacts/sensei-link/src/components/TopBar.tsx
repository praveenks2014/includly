import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import {
  Bell,
  ChevronDown,
  LogOut,
  User,
  CreditCard,
  HelpCircle,
  Check,
  Plus,
  Loader2,
  Baby,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGetMe, useGetMyChildren } from "@workspace/api-client-react";
import type { ChildResponseType } from "@workspace/api-client-react";
import { NAV, SHELL_ROOT, type Role } from "@/nav/config";

const SELECTED_CHILD_KEY = "includly:selectedChildId";

export function TopBar() {
  const [loc, setLocation] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: me } = useGetMe();

  const role = me?.role as Role | undefined;
  const shellRoot = role ? (SHELL_ROOT[role] ?? "/") : "/";

  const tabs = role && role !== "admin" ? NAV[role] : [];
  const activeTab = tabs.find((t) => t.match(loc));
  const screenTitle = activeTab?.label ?? "Includly";

  const initials = user?.fullName
    ? user.fullName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : (user?.firstName?.[0] ?? "U").toUpperCase();

  const { data: children, isLoading: childrenLoading } = useGetMyChildren({
    query: { enabled: role === "parent" },
  });

  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const stored = localStorage.getItem(SELECTED_CHILD_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  useEffect(() => {
    if (!children || children.length === 0) return;
    const valid = children.find((c: ChildResponseType) => c.id === selectedId);
    if (!valid) {
      const first = children[0];
      if (first) {
        setSelectedId(first.id);
        localStorage.setItem(SELECTED_CHILD_KEY, String(first.id));
      }
    }
  }, [children, selectedId]);

  const selectedChild = children?.find((c: ChildResponseType) => c.id === selectedId);
  const childLabel = selectedChild?.name ?? "Select child";

  function handleSelectChild(child: ChildResponseType) {
    setSelectedId(child.id);
    localStorage.setItem(SELECTED_CHILD_KEY, String(child.id));
  }

  function handleSignOut() {
    signOut(() => setLocation("/"));
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-white px-4">
      {role === "parent" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              aria-label="Switch child"
            >
              {childrenLoading ? (
                <Loader2 size={13} className="animate-spin text-gray-400" />
              ) : (
                <Baby size={13} className="shrink-0 text-teal-500" />
              )}
              <span className="max-w-[90px] truncate">{childLabel}</span>
              <ChevronDown size={13} className="shrink-0 text-gray-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {childrenLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-teal-600" />
              </div>
            ) : children && children.length > 0 ? (
              <>
                <div className="px-2 py-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    My children
                  </p>
                </div>
                {children.map((child: ChildResponseType) => (
                  <DropdownMenuItem
                    key={child.id}
                    onClick={() => handleSelectChild(child)}
                    className="flex cursor-pointer items-center justify-between gap-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                        <span className="text-[10px] font-bold">
                          {child.name[0]?.toUpperCase()}
                        </span>
                      </div>
                      <span className="truncate text-sm">{child.name}</span>
                    </div>
                    {child.id === selectedId && (
                      <Check size={14} className="shrink-0 text-teal-600" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            ) : (
              <div className="flex flex-col items-center gap-1 px-3 py-4 text-center">
                <Baby size={20} className="text-gray-300" />
                <p className="text-sm font-medium text-gray-600">No children added</p>
                <p className="text-xs text-muted-foreground">Add your child to get started</p>
              </div>
            )}
            <DropdownMenuItem
              onClick={() => setLocation("/onboarding/child")}
              className="flex cursor-pointer items-center gap-2 text-teal-600 focus:text-teal-700"
            >
              <Plus size={14} />
              Add a child
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Link href={shellRoot} className="flex shrink-0 items-center gap-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600">
            <span className="text-xs font-bold text-white">In</span>
          </div>
          <span className="hidden font-serif text-base font-semibold text-gray-900 sm:block">
            Includly<span className="text-teal-500">·</span>
          </span>
        </Link>
      )}

      <div className="flex-1 text-center">
        <span className="truncate text-sm font-semibold text-gray-800">
          {screenTitle}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100"
          aria-label="Notifications"
        >
          <Bell size={18} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-teal-600 text-xs font-semibold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium">
                {user?.fullName ?? user?.firstName ?? "Account"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.primaryEmailAddress?.emailAddress}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href="/account"
                className="flex cursor-pointer items-center gap-2"
              >
                <User size={14} />
                Account
              </Link>
            </DropdownMenuItem>
            {role === "parent" && (
              <DropdownMenuItem asChild>
                <Link
                  href="/account"
                  className="flex cursor-pointer items-center gap-2"
                >
                  <CreditCard size={14} />
                  Plans &amp; payments
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link
                href="/support"
                className="flex cursor-pointer items-center gap-2"
              >
                <HelpCircle size={14} />
                Help &amp; support
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="flex cursor-pointer items-center gap-2 text-destructive focus:text-destructive"
            >
              <LogOut size={14} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
