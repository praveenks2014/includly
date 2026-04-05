import { Link } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetMe,
  useGetParentDashboard,
  useGetProfessionalDashboard,
  type ParentDashboard,
  type ProfessionalDashboard,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/StarRating";
import { getSpecialtyLabel } from "@/lib/specialties";
import { Loader2, Search, User, BarChart3, Star, Eye, Phone } from "lucide-react";

export default function DashboardPage() {
  const { user } = useUser();
  const { data: me, isLoading: meLoading } = useGetMe();
  const role = me?.role;

  const { data: parentDash, isLoading: parentLoading } = useGetParentDashboard();
  const { data: proDash, isLoading: proLoading } = useGetProfessionalDashboard();

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-serif font-semibold text-foreground">
            Welcome back, {me?.fullName?.split(" ")[0] ?? user?.firstName ?? "there"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {role === "professional" ? "Manage your profile and track your engagement." : "Find and connect with specialists for your child."}
          </p>
        </div>

        {role === "parent" && (
          <ParentDashboard data={parentDash} isLoading={parentLoading} />
        )}
        {role === "professional" && (
          <ProfessionalDashboard data={proDash} isLoading={proLoading} />
        )}
        {!role && (
          <div className="text-center py-12">
            <Loader2 className="animate-spin text-primary mx-auto" size={28} />
          </div>
        )}
      </div>
    </div>
  );
}

function ParentDashboard({ data, isLoading }: { data: ParentDashboard | undefined; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Phone size={18} className="text-primary" />}
          label="Contacts unlocked"
          value={data?.totalUnlocks ?? 0}
        />
        <StatCard
          icon={<Star size={18} className="text-yellow-500" />}
          label="Subscription"
          value={data?.hasActiveSubscription ? "Active" : "Free plan"}
        />
        <StatCard
          icon={<Search size={18} className="text-accent" />}
          label="Search professionals"
          value={<Link href="/search"><Button size="sm" className="mt-1" data-testid="parent-search-cta">Find now</Button></Link>}
        />
      </div>

      {/* Recent unlocks */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Recent contacts unlocked</h2>
          <Link href="/search">
            <Button variant="outline" size="sm" className="gap-1">
              <Search size={14} /> Search more
            </Button>
          </Link>
        </div>
        <div className="p-5">
          {(!data?.recentUnlocks || data.recentUnlocks.length === 0) ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">You haven't unlocked any contacts yet.</p>
              <Link href="/search">
                <Button className="mt-4 gap-2" data-testid="find-specialist-btn">
                  <Search size={15} />
                  Find a specialist
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {data.recentUnlocks.map((unlock) => (
                <div key={unlock.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{unlock.professional?.fullName ?? "Professional"}</p>
                    <p className="text-xs text-muted-foreground">
                      {unlock.professional?.specialty ? getSpecialtyLabel(unlock.professional.specialty) : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(unlock.unlockedAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}
                    </span>
                    <Link href={`/professionals/${unlock.professionalId}`}>
                      <Button variant="outline" size="sm">View</Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfessionalDashboard({ data, isLoading }: { data: ProfessionalDashboard | undefined; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  const profile = data?.profile;

  if (!profile) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center shadow-sm">
        <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <User size={24} className="text-primary" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Set up your profile</h2>
        <p className="text-muted-foreground text-sm mb-6">Create your professional profile to start appearing in search results.</p>
        <Link href="/onboard">
          <Button data-testid="create-profile-btn">Create profile</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={<Eye size={18} className="text-primary" />} label="Profile views" value={data.totalViews ?? 0} />
        <StatCard icon={<Phone size={18} className="text-accent" />} label="Contact unlocks" value={data.totalUnlocks ?? 0} />
        <StatCard icon={<Star size={18} className="text-yellow-500" />} label="Average rating" value={data.averageRating ? data.averageRating.toFixed(1) : "—"} />
        <StatCard icon={<BarChart3 size={18} className="text-primary" />} label="Total reviews" value={data.totalRatings ?? 0} />
      </div>

      {/* Profile card */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">Your profile</h2>
          <Link href="/onboard">
            <Button variant="outline" size="sm">Edit profile</Button>
          </Link>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <div>
              <p className="font-semibold">{profile.fullName ?? "Your name"}</p>
              <span className="text-sm text-muted-foreground">{getSpecialtyLabel(profile.specialty)}</span>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge variant={profile.verificationStatus === "verified" ? "default" : "secondary"}>
              {profile.verificationStatus === "verified" ? "Verified" :
               profile.verificationStatus === "pending" ? "Pending verification" :
               "Not verified"}
            </Badge>
            {profile.city && <Badge variant="outline">{profile.city}</Badge>}
          </div>
        </div>
      </div>

      {/* Recent ratings */}
      <div className="bg-card border border-border rounded-xl shadow-sm">
        <div className="p-5 border-b border-border">
          <h2 className="font-semibold">Recent reviews</h2>
        </div>
        <div className="p-5">
          {(!data.recentRatings || data.recentRatings.length === 0) ? (
            <p className="text-muted-foreground text-sm text-center py-4">No reviews yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentRatings.map((r) => (
                <div key={r.id} className="pb-3 border-b border-border/60 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StarRating value={r.score} size={13} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  </div>
                  {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}
