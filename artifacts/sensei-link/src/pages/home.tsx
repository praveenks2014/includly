import { useState, useEffect, useRef, lazy, Suspense, Component } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { useGetPlatformStats } from "@workspace/api-client-react";
import { STAT_THRESHOLDS } from "@/features";
import { motion, useReducedMotion, useInView } from "framer-motion";
import {
  Search, ShieldCheck, Heart, ArrowRight, Star,
  CheckCircle2, Quote, Instagram, Twitter,
  Linkedin, Facebook, Phone, BookOpen,
  GraduationCap, Brain, Building2, UserCheck, Sparkles,
} from "lucide-react";

const HeroOrb3D = lazy(() => import("@/components/HeroOrb3D"));

class Orb3DBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function useCountUp(target: number, duration = 1800) {
  const [count, setCount] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (!target || started.current) return;
    started.current = true;
    const steps = Math.ceil(duration / 16);
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + increment, target);
      setCount(Math.floor(current));
      if (current >= target) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

const CATEGORY_CARDS = [
  {
    icon: <GraduationCap size={26} className="text-teal-600" />,
    bg: "from-teal-50 to-emerald-50",
    border: "border-teal-100",
    title: "Shadow Teacher",
    desc: "In-classroom support and one-on-one learning assistance for children with special needs.",
    specialty: "shadow_teacher",
  },
  {
    icon: <span className="text-2xl">🤲</span>,
    bg: "from-orange-50 to-amber-50",
    border: "border-orange-100",
    title: "Occupational Therapist",
    desc: "Helping children build daily living skills, fine motor control, and sensory processing.",
    specialty: "occupational_therapy",
  },
  {
    icon: <span className="text-2xl">💬</span>,
    bg: "from-blue-50 to-sky-50",
    border: "border-blue-100",
    title: "Speech Therapist",
    desc: "Improving communication, language development, and swallowing for all age groups.",
    specialty: "speech_therapy",
  },
  {
    icon: <Brain size={26} className="text-violet-600" />,
    bg: "from-violet-50 to-purple-50",
    border: "border-violet-100",
    title: "Child Psychologist",
    desc: "Assessments, therapy, and support for emotional, behavioural, and developmental concerns.",
    specialty: "child_psychologist",
  },
  {
    icon: <BookOpen size={26} className="text-rose-600" />,
    bg: "from-rose-50 to-pink-50",
    border: "border-rose-100",
    title: "Special Educator",
    desc: "Personalised academic instruction aligned to each child's IEP and learning style.",
    specialty: "special_educator",
  },
];

const HOW_IT_WORKS = {
  parents: [
    { num: "01", icon: <UserCheck size={20} className="text-teal-600" />, title: "Create your child's profile", desc: "Add your child's needs, conditions, school, and therapy goals. Profiles help specialists understand your child from day one." },
    { num: "02", icon: <Sparkles size={20} className="text-teal-600" />, title: "Get matched", desc: "Receive scored shadow teacher candidates tailored to your child, or search therapists, special educators, and specialists directly." },
    { num: "03", icon: <Phone size={20} className="text-teal-600" />, title: "Connect & try", desc: "Chat, agree on terms, and book a trial day (shadow teachers) or a first session (therapists and specialists)." },
    { num: "04", icon: <CheckCircle2 size={20} className="text-teal-600" />, title: "Track progress", desc: "Daily logs, goals, and milestones — tracked in your engagement workspace so nothing is lost." },
  ],
  professionals: [
    { num: "01", icon: <UserCheck size={20} className="text-teal-600" />, title: "Create your profile", desc: "Add your specialty, experience, location, availability, and session rates. First month is completely free." },
    { num: "02", icon: <ShieldCheck size={20} className="text-teal-600" />, title: "Get verified", desc: "Upload your ID and credentials. Our team reviews and approves with a verified badge within 48 hours." },
    { num: "03", icon: <Search size={20} className="text-teal-600" />, title: "Get matched & booked", desc: "Appear in parent search results, receive shadow teacher candidacies, or get direct session bookings from families nearby." },
    { num: "04", icon: <Heart size={20} className="text-teal-600" />, title: "Deliver & earn", desc: "Run sessions or engagements, log progress, and get paid securely through the platform." },
  ],
  centres: [
    { num: "01", icon: <Building2 size={20} className="text-teal-600" />, title: "Register your centre", desc: "Complete the setup wizard with your centre's profile, specialties, focus areas, and location." },
    { num: "02", icon: <UserCheck size={20} className="text-teal-600" />, title: "Add your team & services", desc: "List your therapists with their individual specialties and define the services and packages your centre offers." },
    { num: "03", icon: <ShieldCheck size={20} className="text-teal-600" />, title: "Get verified", desc: "Submit for admin review. We verify your MSME registration, certifications, and team credentials for a trust badge." },
    { num: "04", icon: <Star size={20} className="text-teal-600" />, title: "Start receiving enquiries", desc: "Once live, parents can find your centre, send enquiries, and connect with your team directly." },
  ],
};

const TESTIMONIALS = [
  {
    stars: 5,
    quote: "We found our daughter's shadow teacher within 3 days of signing up. The verification badge gave us confidence that she was genuinely qualified. Life-changing.",
    name: "Meena Krishnan",
    role: "Parent of a 7-year-old with autism",
    city: "Chennai",
    initials: "MK",
    color: "bg-teal-600",
  },
  {
    stars: 5,
    quote: "As a speech therapist, Includly brought me 6 new families in my first month. The profile is easy to set up and the leads are genuinely high quality.",
    name: "Rohan Desai",
    role: "Speech-Language Pathologist",
    city: "Pune",
    initials: "RD",
    color: "bg-violet-600",
  },
  {
    stars: 5,
    quote: "Our centre was fully booked within 6 weeks of listing on Includly. The parent community trusts the platform, which means they trust us from day one.",
    name: "Dr. Anita Sharma",
    role: "Director, Bloom Therapy Centre",
    city: "Bengaluru",
    initials: "AS",
    color: "bg-rose-600",
  },
];

function ScrollReveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: prefersReduced ? 0 : 28 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

export default function HomePage() {
  const { isSignedIn } = useUser();
  const { data: stats } = useGetPlatformStats();
  const [howTab, setHowTab] = useState<"parents" | "professionals" | "centres">("parents");
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistState, setWaitlistState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const prefersReduced = useReducedMotion();

  const rawProfCount = stats?.totalProfessionals ?? 0;
  const rawCentreCount = (stats as Record<string, number> | undefined)?.totalCentres ?? 0;
  const rawParentCount = stats?.totalParents ?? 0;

  const animProfCount = useCountUp(rawProfCount);
  const animCentreCount = useCountUp(rawCentreCount);
  const animParentCount = useCountUp(rawParentCount);

  const showProfCount = rawProfCount >= STAT_THRESHOLDS.specialists;
  const showCentreCount = rawCentreCount >= STAT_THRESHOLDS.centres;
  const showParentCount = rawParentCount >= STAT_THRESHOLDS.parents;

  if (isSignedIn) return <Redirect to="/dashboard" />;

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = waitlistEmail.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setWaitlistState("error");
      return;
    }
    setWaitlistState("loading");
    try {
      const basePath = import.meta.env.BASE_URL.replace(/\/+$/, "");
      const res = await fetch(`${window.location.origin}${basePath}/api/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      setWaitlistState(res.ok ? "done" : "error");
    } catch {
      setWaitlistState("error");
    }
  }

  const heroVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.12 } },
  };
  const heroItem = {
    hidden: { opacity: 0, y: prefersReduced ? 0 : 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
  };

  return (
    <div className="min-h-screen bg-white">

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#e8f8f3] via-[#f4faf8] to-[#faf6ef] min-h-[88vh] flex items-center">
        {/* Mesh blobs */}
        <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full bg-teal-200/25 blur-[90px]" />
          <div className="absolute -bottom-24 -left-24 w-[480px] h-[480px] rounded-full bg-emerald-100/40 blur-[80px]" />
          <div className="absolute top-1/3 left-1/3 w-[320px] h-[320px] rounded-full bg-amber-100/20 blur-[70px]" />
        </div>

        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* Left: text content */}
            <motion.div
              variants={heroVariants}
              initial="hidden"
              animate="visible"
              className="text-center lg:text-left"
            >
              <motion.div variants={heroItem}>
                <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm text-teal-700 rounded-full px-4 py-1.5 text-sm font-medium mb-6 border border-teal-200/60 shadow-sm">
                  <Heart size={12} className="fill-teal-500 text-teal-500" />
                  India's trusted special-needs platform
                </div>
              </motion.div>

              <motion.h1
                variants={heroItem}
                className="text-5xl sm:text-6xl lg:text-[3.6rem] xl:text-[4rem] font-serif font-semibold text-gray-900 mb-5 leading-[1.1] tracking-tight"
              >
                Every child deserves<br />
                <span className="text-teal-600">the right support</span>
              </motion.h1>

              <motion.p variants={heroItem} className="text-lg sm:text-xl text-gray-600 max-w-xl mx-auto lg:mx-0 mb-10 leading-relaxed">
                Includly connects families across India with verified shadow teachers, occupational therapists,
                speech therapists, psychologists and therapy centres.
              </motion.p>

              <motion.div variants={heroItem} className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 mb-12">
                <Link href="/sign-up?as=parent">
                  <Button
                    size="lg"
                    className="bg-teal-600 hover:bg-teal-700 text-white gap-2 px-8 h-12 text-base shadow-md shadow-teal-200/60 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-teal-200/70 focus-visible:ring-teal-500"
                    data-testid="hero-parent-cta"
                  >
                    Find Support for My Child
                    <ArrowRight size={16} />
                  </Button>
                </Link>
                <Link href="/sign-up?as=professional">
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-2 border-gray-800 text-gray-800 hover:bg-gray-800 hover:text-white gap-2 px-8 h-12 text-base transition-all hover:-translate-y-0.5"
                    data-testid="hero-professional-cta"
                  >
                    List Your Services
                  </Button>
                </Link>
              </motion.div>

              {/* Trust bar */}
              <motion.div variants={heroItem}>
                <div className="inline-flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-3 bg-white/70 backdrop-blur-sm rounded-2xl px-6 py-4 border border-white/80 shadow-sm">
                  {showProfCount ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-teal-700 font-serif tabular-nums">{animProfCount.toLocaleString()}+</span>
                      <span className="text-sm text-gray-600">Specialists</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-teal-700">Growing network of specialists</span>
                    </div>
                  )}
                  <div className="hidden sm:block w-px bg-gray-200 self-stretch" />
                  {showCentreCount ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold text-teal-700 font-serif tabular-nums">{animCentreCount.toLocaleString()}+</span>
                      <span className="text-sm text-gray-600">Therapy Centres</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-teal-700">Verified centres joining soon</span>
                    </div>
                  )}
                  {showParentCount && (
                    <>
                      <div className="hidden sm:block w-px bg-gray-200 self-stretch" />
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-bold text-teal-700 font-serif tabular-nums">{animParentCount.toLocaleString()}+</span>
                        <span className="text-sm text-gray-600">Children Supported</span>
                      </div>
                    </>
                  )}
                  <div className="hidden sm:block w-px bg-gray-200 self-stretch" />
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-teal-600" />
                    <span className="text-sm font-medium text-gray-700">Verified & Safe</span>
                  </div>
                </div>
              </motion.div>
            </motion.div>

            {/* Right: 3D orb */}
            <motion.div
              className="hidden lg:block relative h-[480px]"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
            >
              {!prefersReduced ? (
                <Orb3DBoundary
                  fallback={<div className="w-full h-full rounded-3xl bg-gradient-to-br from-teal-100/60 via-emerald-50/40 to-amber-50/30" />}
                >
                  <Suspense
                    fallback={
                      <div className="w-full h-full rounded-3xl bg-gradient-to-br from-teal-100/60 to-emerald-50/60" />
                    }
                  >
                    <HeroOrb3D />
                  </Suspense>
                </Orb3DBoundary>
              ) : (
                <div className="w-full h-full rounded-3xl bg-gradient-to-br from-teal-100/60 via-emerald-50/40 to-amber-50/30" />
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── EARLY ACCESS CAPTURE ── */}
      <section id="early-access" className="py-14 px-4 bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto text-center">
          <ScrollReveal>
            <p className="text-sm font-semibold text-teal-600 mb-2 tracking-wide uppercase">Specialist search launching soon</p>
            <h2 className="text-2xl font-serif font-semibold text-gray-900 mb-6">
              Be first to find the right support for your child
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={0.08}>
            {waitlistState === "done" ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center justify-center gap-2.5 bg-teal-50 text-teal-700 font-medium py-4 px-6 rounded-2xl border border-teal-100"
              >
                <CheckCircle2 size={20} className="text-teal-600 shrink-0" />
                <span>You're on the list — we'll email you when specialist search launches.</span>
              </motion.div>
            ) : (
              <form onSubmit={handleWaitlist}>
                <div className="flex flex-col sm:flex-row gap-3 max-w-xl mx-auto">
                  <input
                    type="email"
                    required
                    placeholder="Enter your email for early access"
                    value={waitlistEmail}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                    disabled={waitlistState === "loading"}
                    className="flex-1 h-12 px-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent disabled:opacity-50 transition-all"
                  />
                  <Button
                    type="submit"
                    disabled={waitlistState === "loading"}
                    className="h-12 px-8 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-medium shrink-0 disabled:opacity-60 transition-all hover:-translate-y-0.5 shadow-md shadow-teal-200/50"
                    data-testid="waitlist-submit"
                  >
                    {waitlistState === "loading" ? "Sending…" : "Get Early Access"}
                  </Button>
                </div>
                {waitlistState === "error" && (
                  <p className="text-red-500 text-xs mt-2.5">Please enter a valid email and try again.</p>
                )}
              </form>
            )}
          </ScrollReveal>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-24 px-4 bg-gray-50/80">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal className="text-center mb-12">
            <h2 className="text-3xl font-serif font-semibold text-gray-900 mb-2">How it works</h2>
            <p className="text-gray-500 text-base">Getting started takes less than 5 minutes.</p>
          </ScrollReveal>

          <ScrollReveal delay={0.06} className="flex justify-center mb-12">
            <div className="inline-flex bg-white border border-gray-200 rounded-xl p-1 gap-1 shadow-sm">
              {(["parents", "professionals", "centres"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setHowTab(tab)}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    howTab === tab
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {tab === "parents" ? "For Parents" : tab === "professionals" ? "For Specialists" : "For Therapy Centres"}
                </button>
              ))}
            </div>
          </ScrollReveal>

          <motion.div
            key={howTab}
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.09 } } }}
          >
            {HOW_IT_WORKS[howTab].map((step) => (
              <motion.div
                key={step.num}
                variants={{
                  hidden: { opacity: 0, y: prefersReduced ? 0 : 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
                }}
                whileHover={prefersReduced ? {} : { y: -3, transition: { duration: 0.2 } }}
                className="relative bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="text-4xl font-serif font-bold text-teal-100/80 mb-3 leading-none select-none">{step.num}</div>
                <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center mb-4">
                  {step.icon}
                </div>
                <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">{step.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── CATEGORY GRID ── */}
      <section id="find-professionals" className="py-24 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal className="text-center mb-14">
            <h2 className="text-3xl font-serif font-semibold text-gray-900 mb-2">Find by category</h2>
            <p className="text-gray-500">Every specialist on Includly is background-checked and reviewed by parents like you.</p>
          </ScrollReveal>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
            {CATEGORY_CARDS.map((card, i) => (
              <ScrollReveal key={card.specialty} delay={i * 0.06}>
                <motion.div
                  whileHover={prefersReduced ? {} : { y: -4, transition: { duration: 0.2 } }}
                  className={`flex flex-col gap-3 p-5 sm:p-6 bg-gradient-to-br ${card.bg} border ${card.border} rounded-2xl opacity-75 hover:opacity-100 transition-opacity`}
                  data-testid={`category-${card.specialty}`}
                >
                  <div className="w-11 h-11 bg-white/70 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-sm">
                    {card.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">{card.title}</h3>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{card.desc}</p>
                  </div>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/50">
                    <span className="text-xs text-gray-400 italic">Coming soon</span>
                  </div>
                </motion.div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="py-24 px-4 bg-gray-50/80">
        <div className="max-w-5xl mx-auto">
          <ScrollReveal className="text-center mb-14">
            <h2 className="text-3xl font-serif font-semibold text-gray-900 mb-2">Trusted by families & specialists</h2>
            <p className="text-gray-500">Real stories from real people across India.</p>
          </ScrollReveal>

          <div className="grid sm:grid-cols-3 gap-5 overflow-x-auto sm:overflow-visible pb-2">
            {TESTIMONIALS.map((t, i) => (
              <ScrollReveal key={t.name} delay={i * 0.1}>
                <motion.div
                  whileHover={prefersReduced ? {} : { y: -4, transition: { duration: 0.2 } }}
                  className="flex-shrink-0 w-[82vw] sm:w-auto bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-gray-100/80 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4"
                >
                  <div className="flex gap-0.5">
                    {Array.from({ length: t.stars }).map((_, idx) => (
                      <Star key={idx} size={13} className="fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <Quote size={18} className="text-teal-200" />
                  <p className="text-sm text-gray-700 leading-relaxed flex-1 italic">"{t.quote}"</p>
                  <div className="flex items-center gap-3 pt-2 border-t border-gray-50">
                    <div className={`w-9 h-9 ${t.color} rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {t.initials}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{t.name}</div>
                      <div className="text-xs text-gray-500">{t.role} · {t.city}</div>
                    </div>
                  </div>
                </motion.div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FREE BANNER ── */}
      <section className="py-16 px-4 relative overflow-hidden bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-600">
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
          <div className="absolute -bottom-16 -left-16 w-72 h-72 rounded-full bg-teal-400/20 blur-2xl" />
        </div>
        <ScrollReveal className="relative max-w-3xl mx-auto text-center text-white">
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-full px-4 py-1.5 text-sm font-medium mb-5 border border-white/25">
            <Sparkles size={13} />
            Launch Offer
          </div>
          <h2 className="text-2xl sm:text-3xl font-serif font-semibold mb-3 leading-snug">
            Includly is completely free for families.
          </h2>
          <p className="text-teal-100 text-base mb-2 max-w-xl mx-auto">
            Specialists list for free during our launch period. Join now and grow your reach with zero risk.
          </p>
          <p className="text-teal-200/70 text-xs mb-10">
            Monetisation will be enabled by admin when the platform is ready — you'll be notified in advance.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/sign-up?as=parent">
              <Button className="bg-white text-teal-700 hover:bg-gray-50 gap-2 px-8 h-11 font-semibold shadow-lg shadow-teal-900/20 transition-all hover:-translate-y-0.5">
                Find Support for My Child
                <ArrowRight size={15} />
              </Button>
            </Link>
            <Link href="/sign-up?as=professional">
              <Button variant="outline" className="border-white/50 text-white hover:bg-white/15 gap-2 px-8 h-11 transition-all hover:-translate-y-0.5">
                List Your Services
              </Button>
            </Link>
          </div>
        </ScrollReveal>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-gray-950 text-gray-400 py-16 px-4">
        <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-10">
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">In</span>
              </div>
              <span className="font-serif font-semibold text-lg text-white">Includly</span>
            </div>
            <p className="text-xs leading-relaxed mb-5 text-gray-500">
              India's trusted marketplace connecting families with verified specialists.
            </p>
            <div className="flex gap-2.5">
              {[
                { icon: <Twitter size={14} />, href: "#" },
                { icon: <Instagram size={14} />, href: "#" },
                { icon: <Facebook size={14} />, href: "#" },
                { icon: <Linkedin size={14} />, href: "#" },
              ].map((s, i) => (
                <a
                  key={i}
                  href={s.href}
                  className="w-8 h-8 bg-gray-800 hover:bg-teal-600 rounded-lg flex items-center justify-center transition-colors"
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-white font-semibold text-sm mb-4">For Parents</h4>
            <ul className="space-y-2.5 text-xs">
              {[
                { label: "How It Works", href: "/#how-it-works" },
                { label: "Get Early Access", href: "#early-access" },
                { label: "Support", href: "/support" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-teal-400 transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold text-sm mb-4">For Specialists</h4>
            <ul className="space-y-2.5 text-xs">
              {[
                { label: "List Your Services", href: "/sign-up?as=professional" },
                { label: "Pricing", href: "/pricing" },
                { label: "Get Verified", href: "/sign-up?as=professional" },
                { label: "Dashboard", href: "/dashboard" },
                { label: "Resources", href: "/support" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-teal-400 transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Company</h4>
            <ul className="space-y-2.5 text-xs">
              {[
                { label: "About Us", href: "/" },
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Terms of Service", href: "/terms" },
                { label: "Contact", href: "/support" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-teal-400 transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto border-t border-gray-800 mt-12 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
          <span>© 2026 Includly Technologies Pvt. Ltd. All rights reserved.</span>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-gray-400 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-400 transition-colors">Terms</Link>
            <Link href="/support" className="hover:text-gray-400 transition-colors">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
