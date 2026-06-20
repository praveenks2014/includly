import { useEffect, useRef } from "react";
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
  CheckCheck,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGetMe, useUpdateMe } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { NAV, SHELL_ROOT, type Role } from "@/nav/config";
import { useSelectedChild } from "@/contexts/SelectedChildContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth, getApiBase } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";

interface InAppNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  relatedId: number | null;
  relatedType: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: InAppNotification[];
  unreadCount: number;
}

function useNotifications() {
  return useQuery<NotificationsResponse>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${getApiBase()}/notifications`);
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await fetchWithAuth(`${getApiBase()}/notifications/${id}/read`, { method: "PATCH" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetchWithAuth(`${getApiBase()}/notifications/read-all`, { method: "PATCH" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.notifications ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          aria-label="Notifications"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold text-gray-800">
            Notifications {unreadCount > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">({unreadCount} new)</span>}
          </span>
          {unreadCount > 0 && (
            <button
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 disabled:opacity-50"
            >
              <CheckCheck size={12} />
              Mark all read
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.isRead) markRead.mutate(n.id);
                }}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus:outline-none ${
                  n.isRead ? "" : "bg-teal-50/60"
                }`}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <span className={`text-[13px] leading-snug ${n.isRead ? "font-normal text-gray-700" : "font-semibold text-gray-900"}`}>
                    {n.title}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!n.isRead && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                    )}
                  </div>
                </div>
                <p className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                  {n.body}
                </p>
                <span className="mt-0.5 text-[11px] text-gray-400">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const [loc, setLocation] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: me } = useGetMe();
  const { mutate: updateMeCount } = useUpdateMe();
  const { toast } = useToast();
  const {
    childProfiles,
    childrenLoading,
    selectedChildId,
    selectedChild,
    setSelectedChildId,
  } = useSelectedChild();

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

  // Auto-sync child count: fires ONCE per distinct children.length increase
  // The ref is set BEFORE the async call to prevent re-fire during in-flight PATCH.
  // After the PATCH resolves, me.childCount equals children.length, so
  // "actual > declared" becomes false — no loop even without the ref.
  // The ref closes the narrow window while the PATCH is still in flight.
  const syncedCountRef = useRef<number | null>(null);
  useEffect(() => {
    const declared = me?.childCount ?? null;
    const actual = childProfiles.length;
    if (
      declared != null &&               // parent answered count at onboarding
      actual > declared &&              // children count exceeds declared
      syncedCountRef.current !== actual // haven't already synced for this exact count
    ) {
      syncedCountRef.current = actual;  // guard set before call — prevents re-fire
      updateMeCount({ data: { childCount: actual } });
    }
  }, [childProfiles.length, me?.childCount]);

  function handleSignOut() {
    signOut(() => setLocation("/"));
  }

  function handleAddChild() {
    const declared = me?.childCount ?? null;
    const actual = childProfiles.length;
    if (declared != null && actual >= declared) {
      toast({
        title: "Adding another child?",
        description: `You mentioned ${declared} child${declared !== 1 ? "ren" : ""} at signup — no problem, we'll update your count automatically.`,
      });
    }
    setLocation("/onboarding/child");
  }

  const noChildren = !childrenLoading && childProfiles.length === 0;

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-white px-4">
      {role === "parent" ? (
        childrenLoading ? (
          <button
            disabled
            className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-400"
          >
            <Loader2 size={13} className="animate-spin" />
            <span className="max-w-[90px] truncate">Loading…</span>
          </button>
        ) : noChildren ? (
          <button
            onClick={handleAddChild}
            className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-teal-400 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            aria-label="Add your child"
          >
            <Plus size={13} className="shrink-0 text-teal-500" />
            <span className="max-w-[120px] truncate">Add your child</span>
          </button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                aria-label="Switch child"
              >
                <Baby size={13} className="shrink-0 text-teal-500" />
                <span className="max-w-[90px] truncate">
                  {selectedChild?.name ?? "Select child"}
                </span>
                <ChevronDown size={13} className="shrink-0 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  My children
                </p>
              </div>
              {childProfiles.map((child) => (
                <DropdownMenuItem
                  key={child.id}
                  onClick={() => setSelectedChildId(child.id)}
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
                  {child.id === selectedChildId && (
                    <Check size={14} className="shrink-0 text-teal-600" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleAddChild}
                className="flex cursor-pointer items-center gap-2 text-teal-600 focus:text-teal-700"
              >
                <Plus size={14} />
                Add a child
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
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
        <NotificationBell />

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
