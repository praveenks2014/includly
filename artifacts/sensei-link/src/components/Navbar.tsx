import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Search, LayoutDashboard, LogOut, User, Menu, X,
  Sparkles, Shield, ChevronRight,
} from "lucide-react";
import { useState, useEffect } from "react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const GUEST_NAV = [
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Find Professionals", href: "/search" },
  { label: "Resources", href: "/resources" },
];

export function Navbar() {
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { data: me } = useGetMe({ query: { enabled: !!isSignedIn, queryKey: getGetMeQueryKey() } });
  const isAdmin = me?.role === "admin";

  const initials = user?.fullName
    ? user.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 10);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  function handleSignOut() {
    signOut(() => setLocation("/"));
  }

  function closeMobile() {
    setMobileOpen(false);
  }

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-all duration-200 ${
          scrolled
            ? "bg-white shadow-md border-b border-gray-100"
            : "bg-white/80 backdrop-blur-md border-b border-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">In</span>
            </div>
            <span className="font-serif font-semibold text-lg text-gray-900">
              Includly<span className="text-teal-500 ml-0.5">·</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {isSignedIn ? (
              <>
                <Link href="/search">
                  <Button variant="ghost" size="sm" className="gap-2 text-gray-600 hover:text-gray-900">
                    <Search size={15} />
                    Search
                  </Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="ghost" size="sm" className="gap-2 text-gray-600 hover:text-gray-900">
                    <LayoutDashboard size={15} />
                    Dashboard
                  </Button>
                </Link>
                {isAdmin && (
                  <Link href="/admin">
                    <Button variant="ghost" size="sm" className="gap-2 text-violet-700 hover:text-violet-800 hover:bg-violet-50">
                      <Shield size={15} />
                      Admin
                    </Button>
                  </Link>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="rounded-full w-9 h-9 p-0 ml-1" data-testid="user-menu-trigger">
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-teal-600 text-white text-xs font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem asChild>
                      <Link href="/account" className="flex items-center gap-2 cursor-pointer">
                        <User size={15} />
                        Account
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="flex items-center gap-2 text-destructive focus:text-destructive cursor-pointer"
                      data-testid="sign-out-btn"
                    >
                      <LogOut size={15} />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                {GUEST_NAV.map((item) => (
                  <Link key={item.label} href={item.href}>
                    <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900 text-sm">
                      {item.label}
                    </Button>
                  </Link>
                ))}
                <div className="w-px h-5 bg-gray-200 mx-2" />
                <Link href="/sign-in">
                  <Button variant="ghost" size="sm" className="text-gray-700 hover:text-gray-900">
                    Log In
                  </Button>
                </Link>
                <Link href="/sign-up">
                  <Button size="sm" className="bg-teal-600 hover:bg-teal-700 text-white ml-1">
                    Get Started
                  </Button>
                </Link>
              </>
            )}
          </nav>

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-700"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            data-testid="mobile-menu-btn"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {/* Full-screen mobile drawer */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition-all duration-300 ${
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={closeMobile}
        />

        {/* Drawer panel */}
        <div
          className={`absolute top-0 right-0 h-full w-72 bg-white shadow-2xl flex flex-col transition-transform duration-300 ${
            mobileOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <span className="font-serif font-semibold text-gray-900">Menu</span>
            <button
              onClick={closeMobile}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
            {isSignedIn ? (
              <>
                <MobileNavItem href="/search" icon={<Search size={16} />} label="Search" onClick={closeMobile} />
                <MobileNavItem href="/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" onClick={closeMobile} />
                {isAdmin && (
                  <MobileNavItem href="/admin" icon={<Shield size={16} />} label="Admin" onClick={closeMobile} className="text-violet-700" />
                )}
                <MobileNavItem href="/account" icon={<User size={16} />} label="Account" onClick={closeMobile} />
                <div className="pt-2 border-t border-gray-100 mt-2">
                  <button
                    onClick={() => { handleSignOut(); closeMobile(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-red-600 hover:bg-red-50 transition-colors"
                    data-testid="sign-out-btn"
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                {GUEST_NAV.map((item) => (
                  <MobileNavItem key={item.label} href={item.href} label={item.label} onClick={closeMobile} />
                ))}
                <div className="pt-4 border-t border-gray-100 mt-4 space-y-2">
                  <Link href="/sign-in" onClick={closeMobile}>
                    <Button variant="outline" className="w-full border-gray-200 text-gray-700">
                      Log In
                    </Button>
                  </Link>
                  <Link href="/sign-up" onClick={closeMobile}>
                    <Button className="w-full bg-teal-600 hover:bg-teal-700 text-white">
                      Get Started Free
                      <ChevronRight size={15} className="ml-1" />
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function MobileNavItem({
  href,
  icon,
  label,
  onClick,
  className = "",
}: {
  href: string;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Link href={href} onClick={onClick}>
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors ${className}`}>
        {icon && <span className="text-gray-500">{icon}</span>}
        {label}
      </div>
    </Link>
  );
}
