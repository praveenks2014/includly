import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { SideNav } from "@/components/SideNav";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <SideNav />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
