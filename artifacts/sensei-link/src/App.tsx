import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, useClerk, useAuth } from "@clerk/react";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { setFetchAuthTokenGetter } from "@/lib/api";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { AppShell } from "@/components/AppShell";
import { RequireRole } from "@/guards/RequireRole";
import { RequireChildProfile } from "@/guards/RequireChildProfile";
import { SHELL_ROOT, isShellPath, type Role } from "@/nav/config";
import { useGetMe } from "@workspace/api-client-react";

import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import SearchPage from "@/pages/search";
import ProfessionalProfilePage from "@/pages/professional-profile";
import OnboardPage from "@/pages/onboard";
import AccountPage from "@/pages/account";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import SupportPage from "@/pages/support";
import PricingPage from "@/pages/pricing";
import PaymentSuccessPage from "@/pages/payment-success";
import PaymentCancelPage from "@/pages/payment-cancel";
import AdminPage from "@/pages/admin";
import SignUpPage from "@/pages/sign-up";
import SignInPage from "@/pages/sign-in";
import SsoCallbackPage from "@/pages/sso-callback";
import ChooseRolePage from "@/pages/choose-role";
import ResourcesPage from "@/pages/resources";
import ForumPage from "@/pages/forum";
import ParentDashboard from "@/pages/parent-dashboard";
import ProfessionalDashboard from "@/pages/professional-dashboard";
import CentreDashboard from "@/pages/centre-dashboard";
import ChildOnboardingPage from "@/pages/onboarding-child";

const DEV_CLERK_KEY = "pk_test_Y2hvaWNlLWxpb24tNTcuY2xlcmsuYWNjb3VudHMuZGV2JA";

const clerkPubKey = import.meta.env.DEV
  ? DEV_CLERK_KEY
  : import.meta.env.VITE_CLERK_PK;

if (!clerkPubKey) {
  throw new Error(
    "VITE_CLERK_PK is not set. Add it as a shared environment variable with your Clerk publishable key."
  );
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

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

function ClerkAuthBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    const getter = () => getToken();
    setAuthTokenGetter(getter);
    setFetchAuthTokenGetter(getter);
    return () => {
      setAuthTokenGetter(null);
      setFetchAuthTokenGetter(null);
    };
  }, [getToken]);

  return null;
}

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

// ─── Layout helpers ────────────────────────────────────────────────────────────

const HIDE_NAVBAR_PATHS = ["/sign-in", "/sign-up", "/sso-callback", "/onboarding"];

// Wraps children in AppShell when signed in, bare layout otherwise.
// Used for pages that are public but should show the shell to authenticated users.
function AuthShell({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) return <AppShell>{children}</AppShell>;
  return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
  const [loc] = useLocation();
  const { isSignedIn } = useAuth();
  // Suppress old Navbar on shell paths AND on /support when signed in
  // (AuthShell provides the AppShell header/sidebar for signed-in users there).
  const hideNav =
    HIDE_NAVBAR_PATHS.some((p) => loc.startsWith(p)) ||
    isShellPath(loc) ||
    (isSignedIn === true && loc.startsWith("/support"));
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

// ─── Redirect helpers ──────────────────────────────────────────────────────────

function StaticRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to, { replace: true });
  }, [to, setLocation]);
  return null;
}

function LegacyDashboardRedirect() {
  const { data: me, isLoading } = useGetMe();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    const role = (me?.role ?? "parent") as Role;
    setLocation(SHELL_ROOT[role] ?? "/", { replace: true });
  }, [isLoading, me, setLocation]);

  return (
    <div className="flex h-dvh items-center justify-center">
      <Loader2 className="animate-spin text-teal-600" size={24} />
    </div>
  );
}

function RoleRedirect({ parentTo, proTo, defaultTo }: { parentTo: string; proTo: string; defaultTo: string }) {
  const { data: me } = useGetMe();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const role = me?.role;
    const dest =
      role === "parent" ? parentTo
      : role === "professional" ? proTo
      : defaultTo;
    setLocation(dest, { replace: true });
  }, [me, setLocation, parentTo, proTo, defaultTo]);

  return null;
}

// ─── Stub pages (replaced in later passes) ────────────────────────────────────

function StubPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <h2 className="text-xl font-semibold text-gray-800 mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
    </div>
  );
}

// ─── Router ────────────────────────────────────────────────────────────────────

function Router() {
  return (
    <Layout>
      <Switch>

        {/* ── Legacy redirects (matched before new routes) ── */}
        <Route path="/dashboard">
          <RequireAuth><LegacyDashboardRedirect /></RequireAuth>
        </Route>
        <Route path="/choose-role">
          <StaticRedirect to="/onboarding" />
        </Route>
        <Route path="/onboard">
          <StaticRedirect to="/onboarding/pro" />
        </Route>
        <Route path="/centre-dashboard">
          <StaticRedirect to="/centre/overview" />
        </Route>
        <Route path="/availability">
          <StaticRedirect to="/pro/calendar" />
        </Route>
        <Route path="/engagements">
          <StaticRedirect to="/pro/clients" />
        </Route>
        <Route path="/assessments">
          <StaticRedirect to="/pro/today" />
        </Route>
        <Route path="/assessment-offerings">
          <StaticRedirect to="/pro/today" />
        </Route>
        <Route path="/sessions">
          <RequireAuth>
            <RoleRedirect parentTo="/bookings" proTo="/pro/today" defaultTo="/home" />
          </RequireAuth>
        </Route>
        {/* Legacy professional profile URL → new canonical */}
        <Route path="/professionals/:id">
          {(params) => <StaticRedirect to={`/p/${params.id}`} />}
        </Route>

        {/* Pre-N1 prefixed paths → new shell roots */}
        <Route path="/parent">
          <StaticRedirect to="/home" />
        </Route>
        <Route path="/parent/:rest*">
          <StaticRedirect to="/home" />
        </Route>
        <Route path="/pro">
          <StaticRedirect to="/pro/today" />
        </Route>
        <Route path="/pro/dashboard">
          <StaticRedirect to="/pro/today" />
        </Route>
        <Route path="/pro/home">
          <StaticRedirect to="/pro/today" />
        </Route>
        <Route path="/centre">
          <StaticRedirect to="/centre/overview" />
        </Route>
        <Route path="/centre/dashboard">
          <StaticRedirect to="/centre/overview" />
        </Route>

        {/* ── Public pages ── */}
        <Route path="/" component={HomePage} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/sso-callback" component={SsoCallbackPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/p/:id" component={ProfessionalProfilePage} />
        <Route path="/pricing" component={PricingPage} />
        <Route path="/payment/success" component={PaymentSuccessPage} />
        <Route path="/payment/cancel" component={PaymentCancelPage} />
        <Route path="/resources" component={ResourcesPage} />
        <Route path="/forum" component={ForumPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/support">
          <AuthShell>
            <SupportPage />
          </AuthShell>
        </Route>

        {/* ── Onboarding (RequireAuth, no AppShell chrome) ── */}
        <Route path="/onboarding/pro">
          <RequireAuth><OnboardPage /></RequireAuth>
        </Route>
        <Route path="/onboarding/child">
          <RequireAuth><ChildOnboardingPage /></RequireAuth>
        </Route>
        <Route path="/onboarding">
          <RequireAuth><ChooseRolePage /></RequireAuth>
        </Route>

        {/* ── Account ── */}
        <Route path="/account">
          <RequireAuth>
            <AppShell>
              <AccountPage />
            </AppShell>
          </RequireAuth>
        </Route>

        {/* ── Admin (auth, existing layout — no AppShell) ── */}
        <Route path="/admin">
          <RequireAuth><AdminPage /></RequireAuth>
        </Route>

        {/* ── Parent shell ── */}
        <Route path="/home">
          <RequireAuth>
            <RequireRole allow={["parent"]}>
              <RequireChildProfile>
                <AppShell>
                  <ParentDashboard initialTab="home" />
                </AppShell>
              </RequireChildProfile>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/explore">
          <RequireAuth>
            <RequireRole allow={["parent"]}>
              <AppShell>
                <ParentDashboard initialTab="find" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/bookings/:id?">
          <RequireAuth>
            <RequireRole allow={["parent"]}>
              <AppShell>
                <ParentDashboard initialTab="bookings" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/journey">
          <RequireAuth>
            <RequireRole allow={["parent"]}>
              <AppShell>
                <StubPage
                  title="Journey"
                  description="Track your child's progress, goals, and milestones — coming in V2."
                />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/inbox/:threadId?">
          <RequireAuth>
            <RequireRole allow={["parent"]}>
              <AppShell>
                <ParentDashboard initialTab="messages" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/shadow-teacher">
          <RequireAuth>
            <RequireRole allow={["parent"]}>
              <RequireChildProfile>
                <AppShell>
                  <ParentDashboard initialTab="shadow-teacher" />
                </AppShell>
              </RequireChildProfile>
            </RequireRole>
          </RequireAuth>
        </Route>

        {/* ── Professional shell ── */}
        <Route path="/pro/today">
          <RequireAuth>
            <RequireRole allow={["professional"]}>
              <AppShell>
                <ProfessionalDashboard initialTab="home" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/pro/calendar">
          <RequireAuth>
            <RequireRole allow={["professional"]}>
              <AppShell>
                <ProfessionalDashboard initialTab="availability" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/pro/clients/:childId?">
          <RequireAuth>
            <RequireRole allow={["professional"]}>
              <AppShell>
                <StubPage
                  title="My Clients"
                  description="Your client roster with goals, notes, and session history — coming in V2."
                />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/pro/inbox/:threadId?">
          <RequireAuth>
            <RequireRole allow={["professional"]}>
              <AppShell>
                <ProfessionalDashboard initialTab="messages" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/pro/earnings">
          <RequireAuth>
            <RequireRole allow={["professional"]}>
              <AppShell>
                <ProfessionalDashboard initialTab="earnings" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>

        {/* ── Centre shell ── */}
        <Route path="/centre/overview">
          <RequireAuth>
            <RequireRole allow={["centre_admin"]}>
              <AppShell>
                <CentreDashboard initialTab="overview" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/centre/bookings">
          <RequireAuth>
            <RequireRole allow={["centre_admin"]}>
              <AppShell>
                <CentreDashboard initialTab="overview" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/centre/roster">
          <RequireAuth>
            <RequireRole allow={["centre_admin"]}>
              <AppShell>
                <CentreDashboard initialTab="therapists" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/centre/services">
          <RequireAuth>
            <RequireRole allow={["centre_admin"]}>
              <AppShell>
                <CentreDashboard initialTab="services" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>
        <Route path="/centre/inbox">
          <RequireAuth>
            <RequireRole allow={["centre_admin"]}>
              <AppShell>
                <CentreDashboard initialTab="overview" />
              </AppShell>
            </RequireRole>
          </RequireAuth>
        </Route>

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
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
      routerPush={(to) => {
        if (to.startsWith("http://") || to.startsWith("https://")) {
          window.location.href = to;
        } else {
          setLocation(stripBase(to));
        }
      }}
      routerReplace={(to) => {
        if (to.startsWith("http://") || to.startsWith("https://")) {
          window.location.replace(to);
        } else {
          setLocation(stripBase(to), { replace: true });
        }
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkAuthBridge />
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
