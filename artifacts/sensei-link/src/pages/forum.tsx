import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MessageCircle, Users, Sparkles, Bell, ArrowRight, CheckCircle } from "lucide-react";

export default function ForumPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast({ title: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    setSubmitted(true);
    toast({ title: "You're on the list! 🎉", description: "We'll notify you when the forum launches." });
  }

  const FEATURES = [
    { icon: <Users size={20} className="text-[#2EC4A5]" />, title: "Parent Community", desc: "Connect with thousands of Indian families navigating the same journey." },
    { icon: <MessageCircle size={20} className="text-[#FF6B6B]" />, title: "Ask Professionals", desc: "Get answers from verified therapists, educators, and specialists." },
    { icon: <Sparkles size={20} className="text-[#FFB830]" />, title: "Resource Sharing", desc: "Discover tools, worksheets, and strategies that actually work." },
    { icon: <Bell size={20} className="text-violet-500" />, title: "Early Notifications", desc: "Sign up now and be first to know when we launch." },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#1A2340] via-[#1e2d56] to-[#1A2340] text-white overflow-hidden relative">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-10 left-20 w-64 h-64 rounded-full bg-[#2EC4A5] blur-3xl" />
          <div className="absolute bottom-10 right-20 w-48 h-48 rounded-full bg-[#FF6B6B] blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-20 sm:py-28 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 text-white/90 text-xs font-semibold px-4 py-1.5 rounded-full mb-6 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-[#FFB830] animate-pulse" />
            Coming Soon
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
            A community built for<br />
            <span className="text-[#2EC4A5]">families like yours</span>
          </h1>
          <p className="text-white/70 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto mb-10">
            The Includly Forum is India's upcoming dedicated space for parents, caregivers, and special education professionals to connect, share, and grow together.
          </p>

          {/* Email signup */}
          {submitted ? (
            <div className="inline-flex items-center gap-3 bg-[#2EC4A5]/20 border border-[#2EC4A5]/40 text-[#2EC4A5] px-6 py-4 rounded-xl backdrop-blur-sm">
              <CheckCircle size={20} />
              <span className="font-semibold">You're on the list! We'll email you when we launch.</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto" aria-label="Forum notification signup">
              <Input
                type="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus-visible:ring-[#2EC4A5] rounded-lg h-12"
                aria-label="Email address for forum notifications"
                required
              />
              <Button
                type="submit"
                disabled={loading}
                className="h-12 px-6 bg-[#2EC4A5] hover:bg-[#26a88d] text-white font-semibold rounded-lg whitespace-nowrap focus-visible:ring-2 focus-visible:ring-white"
                aria-label="Notify me when forum launches"
              >
                {loading ? "Saving…" : (
                  <span className="flex items-center gap-2">
                    Notify Me
                    <ArrowRight size={16} />
                  </span>
                )}
              </Button>
            </form>
          )}

          <p className="text-white/40 text-xs mt-4">No spam, ever. Unsubscribe at any time.</p>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="font-serif text-3xl font-bold text-[#1A2340] mb-3">What to expect</h2>
          <p className="text-gray-500 max-w-xl mx-auto">We're building the most supportive community for Indian families navigating special education.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 mb-16">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-gray-100 p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] flex gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
                {f.icon}
              </div>
              <div>
                <p className="font-semibold text-[#1A2340] mb-1">{f.title}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Illustration placeholder */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_4px_24px_rgba(26,35,64,0.08)] p-10 text-center">
          <svg width="120" height="120" viewBox="0 0 120 120" fill="none" className="mx-auto mb-6">
            <circle cx="60" cy="60" r="60" fill="#2EC4A5" fillOpacity="0.08"/>
            <circle cx="40" cy="50" r="14" fill="#2EC4A5" fillOpacity="0.3"/>
            <circle cx="80" cy="50" r="14" fill="#FF6B6B" fillOpacity="0.3"/>
            <circle cx="60" cy="72" r="14" fill="#FFB830" fillOpacity="0.3"/>
            <path d="M40 50 L60 72 L80 50" stroke="#1A2340" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.2"/>
            <circle cx="40" cy="50" r="8" fill="#2EC4A5"/>
            <circle cx="80" cy="50" r="8" fill="#FF6B6B"/>
            <circle cx="60" cy="72" r="8" fill="#FFB830"/>
          </svg>
          <h3 className="font-serif text-2xl font-bold text-[#1A2340] mb-3">Building together</h3>
          <p className="text-gray-500 max-w-md mx-auto mb-6">
            The forum will launch later this year. Sign up above to be among the first members and help shape what it becomes.
          </p>
          {!submitted && (
            <Button
              onClick={() => document.querySelector('input[type="email"]')?.scrollIntoView({ behavior: "smooth" })}
              className="bg-[#2EC4A5] hover:bg-[#26a88d] text-white focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
              aria-label="Get notified when forum launches"
            >
              Get Notified
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
