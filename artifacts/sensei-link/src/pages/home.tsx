import { useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGetPlatformStats } from "@workspace/api-client-react";
import { getSpecialtyLabel } from "@/lib/specialties";
import {
  Search, ShieldCheck, Heart, ArrowRight, Stethoscope, Building2, UserCheck,
  CheckCircle2, Star, Users, IndianRupee,
} from "lucide-react";

const SPECIALTIES = [
  { value: "shadow_teacher", icon: "👨‍🏫" },
  { value: "special_tutor", icon: "📚" },
  { value: "occupational_therapy", icon: "🤲" },
  { value: "speech_therapy", icon: "💬" },
  { value: "psychiatrist", icon: "🧠" },
  { value: "developmental_pediatrician", icon: "🩺" },
  { value: "neurologist", icon: "🔬" },
  { value: "therapy_centre", icon: "🏥" },
];

const PROFESSIONAL_PLANS = [
  {
    icon: <UserCheck size={20} className="text-blue-600" />,
    iconBg: "bg-blue-100",
    title: "Educator / Therapist",
    badge: null,
    badgeClass: "",
    price: "₹99",
    period: "/month",
    description: "Shadow Teachers, Special Tutors, Speech Therapists, Occupational Therapists.",
    features: ["Verified listing", "Parent enquiry leads", "Online & home session booking", "₹49 platform fee per session"],
    link: "/sign-up?as=professional",
    cta: "Get listed →",
    highlight: false,
  },
  {
    icon: <Building2 size={20} className="text-purple-600" />,
    iconBg: "bg-purple-100",
    title: "Therapy Centre",
    badge: "Most Popular",
    badgeClass: "bg-purple-100 text-purple-700",
    price: "₹999",
    period: "/month",
    description: "ABA centres, multi-discipline therapy hubs, and special education centres.",
    features: ["Premium placement in search", "Unlimited seat listings", "Centre profile + team bios", "₹149 platform fee per session"],
    link: "/sign-up?as=professional",
    cta: "Register centre →",
    highlight: true,
  },
  {
    icon: <Stethoscope size={20} className="text-green-600" />,
    iconBg: "bg-green-100",
    title: "Medical Specialist",
    badge: null,
    badgeClass: "",
    price: "₹299",
    period: "/month",
    description: "Neurologists, Psychiatrists, Developmental Pediatricians.",
    features: ["Premium listing badge", "Appointment booking", "Teleconsultation support", "₹99 platform fee per session"],
    link: "/sign-up?as=professional",
    cta: "Join as specialist →",
    highlight: false,
  },
];

export default function HomePage() {
  const { isSignedIn } = useUser();
  const { data: stats } = useGetPlatformStats();
  const [activeTab, setActiveTab] = useState<"parents" | "professionals">("parents");

  if (isSignedIn) {
    return <Redirect to="/dashboard" />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary/8 via-background to-accent/5 py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium mb-6 border border-primary/20">
            <Heart size={14} className="fill-primary" />
            Trusted by parents across India
          </div>
          <h1 className="text-4xl sm:text-5xl font-serif font-semibold text-foreground mb-6 leading-tight">
            Find the right specialist<br />
            <span className="text-primary">for your child's journey</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Sproutly connects parents with verified Shadow Teachers, Special Educators, and Medical Specialists — so every child gets the support they deserve.
          </p>

          {/* Prominent Toggle */}
          <div className="inline-flex bg-muted border border-border rounded-xl p-1 mb-8" data-testid="home-toggle">
            <button
              onClick={() => setActiveTab("parents")}
              data-testid="tab-parents"
              className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === "parents"
                  ? "bg-background shadow text-foreground border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <Heart size={14} />
                I'm a parent / carer
              </span>
            </button>
            <button
              onClick={() => setActiveTab("professionals")}
              data-testid="tab-professionals"
              className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === "professionals"
                  ? "bg-background shadow text-foreground border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <UserCheck size={14} />
                I'm a specialist / centre
              </span>
            </button>
          </div>

          {activeTab === "parents" && (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/sign-up">
                <Button size="lg" className="gap-2 px-8" data-testid="hero-get-started">
                  Get started free
                  <ArrowRight size={16} />
                </Button>
              </Link>
              <Link href="/search">
                <Button variant="outline" size="lg" className="gap-2 px-8" data-testid="hero-search">
                  <Search size={16} />
                  Browse specialists
                </Button>
              </Link>
            </div>
          )}

          {activeTab === "professionals" && (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/sign-up?as=professional">
                <Button size="lg" className="gap-2 px-8" data-testid="hero-get-listed">
                  Get listed — first month free
                  <ArrowRight size={16} />
                </Button>
              </Link>
              <Link href="/sign-in">
                <Button variant="outline" size="lg" className="gap-2 px-8">
                  Sign in to dashboard
                </Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Stats */}
      {stats && (
        <section className="py-12 border-y border-border bg-muted/30">
          <div className="max-w-4xl mx-auto px-4 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-2xl sm:text-3xl font-serif font-bold text-primary">{stats.totalProfessionals ?? 0}+</div>
              <div className="text-sm text-muted-foreground mt-1">Specialists</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-serif font-bold text-primary">{stats.verifiedCount ?? 0}+</div>
              <div className="text-sm text-muted-foreground mt-1">Verified</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-serif font-bold text-primary">{stats.totalParents ?? 0}+</div>
              <div className="text-sm text-muted-foreground mt-1">Families helped</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-serif font-bold text-primary">{stats.totalRatings ?? 0}+</div>
              <div className="text-sm text-muted-foreground mt-1">Reviews</div>
            </div>
          </div>
        </section>
      )}

      {/* For Parents tab content */}
      {activeTab === "parents" && (
        <>
          {/* Specialties */}
          <section className="py-16 px-4">
            <div className="max-w-5xl mx-auto">
              <h2 className="text-2xl font-serif font-semibold text-center text-foreground mb-2">Browse by specialty</h2>
              <p className="text-muted-foreground text-center mb-10">Every specialist on Sproutly is background-checked and reviewed by parents like you.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {SPECIALTIES.map((s) => (
                  <Link key={s.value} href={`/search?specialty=${s.value}`}>
                    <div className="group flex flex-col items-center gap-2 p-5 bg-card border border-border rounded-xl hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer" data-testid={`specialty-${s.value}`}>
                      <span className="text-3xl" role="img">{s.icon}</span>
                      <span className="text-sm font-medium text-foreground text-center group-hover:text-primary transition-colors">
                        {getSpecialtyLabel(s.value)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          {/* Why Sproutly */}
          <section className="py-16 px-4 bg-muted/20 border-y border-border">
            <div className="max-w-5xl mx-auto">
              <h2 className="text-2xl font-serif font-semibold text-center mb-10">Why parents choose Sproutly</h2>
              <div className="grid sm:grid-cols-3 gap-8">
                <div className="text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ShieldCheck size={24} className="text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Verified professionals</h3>
                  <p className="text-sm text-muted-foreground">Every specialist goes through ID and credential verification before their profile is published.</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search size={24} className="text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Smart search</h3>
                  <p className="text-sm text-muted-foreground">Filter by specialty, city, experience and travel availability to find the perfect match.</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Heart size={24} className="text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Parent reviews</h3>
                  <p className="text-sm text-muted-foreground">Read honest reviews from other parents who've worked with each specialist.</p>
                </div>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="py-20 px-4 text-center">
            <div className="max-w-2xl mx-auto">
              <h2 className="text-3xl font-serif font-semibold mb-4">Ready to find the right support?</h2>
              <p className="text-muted-foreground mb-8">Join thousands of families who've found the perfect specialist through Sproutly.</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/sign-up">
                  <Button size="lg" className="gap-2 px-8">
                    Create a free account
                    <ArrowRight size={16} />
                  </Button>
                </Link>
                <Link href="/sign-in">
                  <Button variant="outline" size="lg" className="px-8">
                    Sign in
                  </Button>
                </Link>
              </div>
            </div>
          </section>
        </>
      )}

      {/* For Professionals tab content */}
      {activeTab === "professionals" && (
        <>
          {/* Value props */}
          <section className="py-16 px-4">
            <div className="max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl font-serif font-semibold text-foreground mb-2">Grow your practice with Sproutly</h2>
                <p className="text-muted-foreground max-w-xl mx-auto">Reach families actively looking for specialists like you. First month is completely free — no credit card required.</p>
              </div>
              <div className="grid sm:grid-cols-3 gap-8 mb-12">
                <div className="text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Users size={24} className="text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Qualified leads</h3>
                  <p className="text-sm text-muted-foreground">Parents on Sproutly are actively searching for specialists. These are high-intent, ready-to-engage families.</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Star size={24} className="text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Build credibility</h3>
                  <p className="text-sm text-muted-foreground">Get verified, collect reviews, and build a strong reputation that families trust when making decisions.</p>
                </div>
                <div className="text-center">
                  <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <IndianRupee size={24} className="text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">Simple pricing</h3>
                  <p className="text-sm text-muted-foreground">Flat monthly fee by specialty — no hidden charges, no lead credits, no bidding. Small platform fee per confirmed session.</p>
                </div>
              </div>

              {/* Pricing Cards */}
              <div className="grid sm:grid-cols-3 gap-6">
                {PROFESSIONAL_PLANS.map((plan) => (
                  <div
                    key={plan.title}
                    className={`bg-card border rounded-xl p-6 flex flex-col gap-3 transition-all ${
                      plan.highlight
                        ? "border-primary/50 ring-1 ring-primary/20 shadow-sm"
                        : "border-border hover:border-primary/40 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className={`w-10 h-10 ${plan.iconBg} rounded-lg flex items-center justify-center`}>
                        {plan.icon}
                      </div>
                      {plan.badge && (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${plan.badgeClass}`}>
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{plan.title}</h3>
                      <div className="flex items-baseline gap-0.5 mt-1">
                        <span className="text-2xl font-bold text-foreground">{plan.price}</span>
                        <span className="text-sm text-muted-foreground">{plan.period}</span>
                      </div>
                      <p className="text-xs text-primary font-medium mt-0.5">First month FREE</p>
                    </div>
                    <p className="text-sm text-muted-foreground flex-1">{plan.description}</p>
                    <ul className="space-y-1.5">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Link href={plan.link}>
                      <Button
                        className="w-full mt-2"
                        size="sm"
                        variant={plan.highlight ? "default" : "outline"}
                        data-testid={`plan-cta-${plan.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {plan.cta}
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>

              <p className="text-center text-xs text-muted-foreground mt-8">
                Already have an account?{" "}
                <Link href="/sign-in" className="text-primary hover:underline">Sign in</Link>
                {" "}and go to your dashboard to complete your profile.
              </p>
            </div>
          </section>
        </>
      )}

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="font-serif font-semibold text-foreground">Sproutly</div>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/support" className="hover:text-foreground transition-colors">Support</Link>
          </div>
          <div>2026 Sproutly. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
