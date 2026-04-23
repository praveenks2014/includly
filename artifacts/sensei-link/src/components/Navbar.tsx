import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, LayoutDashboard, LogOut, User, Menu, X, Sparkles } from "lucide-react";
import { useState } from "react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Navbar() {
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = user?.fullName
    ? user.fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  function handleSignOut() {
    signOut(() => setLocation("/"));
  }

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm border-b border-border shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-sm">In</span>
          </div>
          <span className="font-serif font-semibold text-lg text-foreground">Includly</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-2">
          {isSignedIn ? (
            <>
              <Link href="/search">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Search size={16} />
                  Search
                </Button>
              </Link>
              <Link href="/pricing">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Sparkles size={16} />
                  Pricing
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="ghost" size="sm" className="gap-2">
                  <LayoutDashboard size={16} />
                  Dashboard
                </Button>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="rounded-full w-9 h-9 p-0" data-testid="user-menu-trigger">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
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
              <Link href="/sign-in">
                <Button variant="ghost" size="sm">Sign in</Button>
              </Link>
              <Link href="/sign-up">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </nav>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden p-2 rounded-md hover:bg-muted transition-colors"
          onClick={() => setMobileOpen(!mobileOpen)}
          data-testid="mobile-menu-btn"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-white/95 backdrop-blur-sm px-4 py-4 flex flex-col gap-2">
          {isSignedIn ? (
            <>
              <Link href="/search" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <Search size={16} /> Search
                </Button>
              </Link>
              <Link href="/pricing" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <Sparkles size={16} /> Pricing
                </Button>
              </Link>
              <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <LayoutDashboard size={16} /> Dashboard
                </Button>
              </Link>
              <Link href="/account" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <User size={16} /> Account
                </Button>
              </Link>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                onClick={handleSignOut}
              >
                <LogOut size={16} /> Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/sign-in" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" className="w-full">Sign in</Button>
              </Link>
              <Link href="/sign-up" onClick={() => setMobileOpen(false)}>
                <Button className="w-full">Get started</Button>
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
