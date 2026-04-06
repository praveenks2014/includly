import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGetPlatformStats } from "@workspace/api-client-react";
import { getSpecialtyLabel } from "@/lib/specialties";
import { Search, ShieldCheck, Heart, ArrowRight } from "lucide-react";

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

export default function HomePage() {
  const { isSignedIn } = useUser();
  const { data: stats } = useGetPlatformStats();

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
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            Sproutly connects parents with verified Shadow Teachers, Special Educators, and Medical Specialists — so every child gets the support they deserve.
          </p>
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
