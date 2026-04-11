import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, useClerk, useAuth } from "@clerk/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useRef } from "react";
import { Navbar } from "@/components/Navbar";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import SearchPage from "@/pages/search";
import ProfessionalProfilePage from "@/pages/professional-profile";
import DashboardPage from "@/pages/dashboard";
import OnboardPage from "@/pages/onboard";
import AccountPage from "@/pages/account";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import SupportPage from "@/pages/support";
import PricingPage from "@/pages/pricing";
import PaymentSuccessPage from "@/pages/payment-success";
import PaymentCancelPage from "@/pages/payment-cancel";
import AdminPage from "@/pages/admin";
import AvailabilityPage from "@/pages/availability";
import SessionsPage from "@/pages/sessions";
import SignUpPage from "@/pages/sign-up";
import SignInPage from "@/pages/sign-in";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

const HIDE_NAVBAR_PATHS = ["/sign-in", "/sign-up"];

function Layout({ children }: { children: React.ReactNode }) {
  const [loc] = useLocation();
  const hideNav = HIDE_NAVBAR_PATHS.some((p) => loc.startsWith(p));
  return (
    <>
      {!hideNav && <Navbar />}
      {children}
    </>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      setLocation(`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded) return null;
  if (!isSignedIn) return null;
  return <>{children}</>;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/professionals/:id" component={ProfessionalProfilePage} />
        <Route path="/dashboard">
          <RequireAuth><DashboardPage /></RequireAuth>
        </Route>
        <Route path="/onboard">
          <RequireAuth><OnboardPage /></RequireAuth>
        </Route>
        <Route path="/account">
          <RequireAuth><AccountPage /></RequireAuth>
        </Route>
        <Route path="/pricing" component={PricingPage} />
        <Route path="/payment/success" component={PaymentSuccessPage} />
        <Route path="/payment/cancel" component={PaymentCancelPage} />
        <Route path="/admin">
          <RequireAuth><AdminPage /></RequireAuth>
        </Route>
        <Route path="/availability">
          <RequireAuth><AvailabilityPage /></RequireAuth>
        </Route>
        <Route path="/sessions">
          <RequireAuth><SessionsPage /></RequireAuth>
        </Route>
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/support" component={SupportPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl || undefined}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
