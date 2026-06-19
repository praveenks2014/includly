import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { useGetPlatformStats } from "@workspace/api-client-react";
import {
  Search, ShieldCheck, Heart, ArrowRight, Star, ChevronDown,
  MapPin, Clock, CheckCircle2, Quote, Instagram, Twitter,
  Linkedin, Facebook, Phone, BookOpen, Stethoscope,
  GraduationCap, Brain, Building2, UserCheck, Sparkles,
} from "lucide-react";

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
    icon: <GraduationCap size={28} className="text-teal-600" />,
    bg: "bg-teal-50",
    title: "Shadow Teacher",
    desc: "In-classroom support and one-on-one learning assistance for children with special needs.",
    count: 420,
    specialty: "shadow_teacher",
  },
  {
    icon: <span className="text-2xl">🤲</span>,
    bg: "bg-orange-50",
    title: "Occupational Therapist",
    desc: "Helping children build daily living skills, fine motor control, and sensory processing.",
    count: 310,
    specialty: "occupational_therapy",
  },
  {
    icon: <span className="text-2xl">💬</span>,
    bg: "bg-blue-50",
    title: "Speech Therapist",
    desc: "Improving communication, language development, and swallowing for all age groups.",
    count: 280,
    specialty: "speech_therapy",
  },
  {
    icon: <Brain size={28} className="text-violet-600" />,
    bg: "bg-violet-50",
    title: "Child Psychologist",
    desc: "Assessments, therapy, and support for emotional, behavioural, and developmental concerns.",
    count: 190,
    specialty: "child_psychologist",
  },
  {
    icon: <BookOpen size={28} className="text-rose-600" />,
    bg: "bg-rose-50",
    title: "Special Educator",
    desc: "Personalised academic instruction aligned to each child's IEP and learning style.",
    count: 360,
    specialty: "special_educator",
  },
];

const HOW_IT_WORKS = {
  parents: [
    { num: "01", icon: <UserCheck size={22} className="text-teal-600" />, title: "Create your child's profile", desc: "Add your child's needs, conditions, school, and therapy goals. Profiles help specialists understand your child from day one." },
    { num: "02", icon: <Sparkles size={22} className="text-teal-600" />, title: "Get matched", desc: "Receive scored shadow teacher candidates tailored to your child, or search therapists, special educators, and specialists directly." },
    { num: "03", icon: <Phone size={22} className="text-teal-600" />, title: "Connect & try", desc: "Chat, agree on terms, and book a trial day (shadow teachers) or a first session (therapists and specialists)." },
    { num: "04", icon: <CheckCircle2 size={22} className="text-teal-600" />, title: "Track progress", desc: "Daily logs, goals, and milestones — tracked in your engagement workspace so nothing is lost." },
  ],
  professionals: [
    { num: "01", icon: <UserCheck size={22} className="text-teal-600" />, title: "Create your profile", desc: "Add your specialty, experience, location, availability, and session rates. First month is completely free." },
    { num: "02", icon: <ShieldCheck size={22} className="text-teal-600" />, title: "Get verified", desc: "Upload your ID and credentials. Our team reviews and approves with a verified badge within 48 hours." },
    { num: "03", icon: <Search size={22} className="text-teal-600" />, title: "Get matched & booked", desc: "Appear in parent search results, receive shadow teacher candidacies, or get direct session bookings from families nearby." },
    { num: "04", icon: <Heart size={22} className="text-teal-600" />, title: "Deliver & earn", desc: "Run sessions or engagements, log progress, and get paid securely through the platform." },
  ],
  centres: [
    { num: "01", icon: <Building2 size={22} className="text-teal-600" />, title: "Register your centre", desc: "Complete the setup wizard with your centre's profile, specialties, focus areas, and location." },
    { num: "02", icon: <UserCheck size={22} className="text-teal-600" />, title: "Add your team & services", desc: "List your therapists with their individual specialties and define the services and packages your centre offers." },
    { num: "03", icon: <ShieldCheck size={22} className="text-teal-600" />, title: "Get verified", desc: "Submit for admin review. We verify your MSME registration, certifications, and team credentials for a trust badge." },
    { num: "04", icon: <Star size={22} className="text-teal-600" />, title: "Start receiving enquiries", desc: "Once live, parents can find your centre, send enquiries, and connect with your team directly." },
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
    bg: "bg-teal-600",
  },
  {
    stars: 5,
    quote: "As a speech therapist, Includly brought me 6 new families in my first month. The profile is easy to set up and the leads are genuinely high quality.",
    name: "Rohan Desai",
    role: "Speech-Language Pathologist",
    city: "Pune",
    initials: "RD",
    bg: "bg-violet-600",
  },
  {
    stars: 5,
    quote: "Our centre was fully booked within 6 weeks of listing on Includly. The parent community trusts the platform, which means they trust us from day one.",
    name: "Dr. Anita Sharma",
    role: "Director, Bloom Therapy Centre",
    city: "Bengaluru",
    initials: "AS",
    bg: "bg-rose-600",
  },
];

const QUICK_CHIPS = [
  { label: "Shadow Teacher", specialty: "shadow_teacher" },
  { label: "Speech Therapy", specialty: "speech_therapy" },
  { label: "Occupational Therapy", specialty: "occupational_therapy" },
  { label: "ABA Therapy", specialty: "aba_therapy" },
  { label: "Sensory Integration", specialty: "sensory_integration" },
];

const SPECIALTIES_OPTIONS = [
  { value: "", label: "All Specialties" },
  { value: "shadow_teacher", label: "Shadow Teacher" },
  { value: "speech_therapy", label: "Speech Therapy" },
  { value: "occupational_therapy", label: "Occupational Therapy" },
  { value: "aba_therapy", label: "ABA Therapy" },
  { value: "sensory_integration", label: "Sensory Integration" },
  { value: "special_educator", label: "Special Educator" },
  { value: "child_psychologist", label: "Child Psychologist" },
];

const AGE_OPTIONS = [
  { value: "", label: "Any Age" },
  { value: "0-3", label: "0–3 years (Infant)" },
  { value: "3-6", label: "3–6 years (Toddler)" },
  { value: "6-12", label: "6–12 years (School-age)" },
  { value: "12-18", label: "12–18 years (Teen)" },
  { value: "18+", label: "18+ (Adult)" },
];

export default function HomePage() {
  const { isSignedIn } = useUser();
  const { data: stats } = useGetPlatformStats();
  const [howTab, setHowTab] = useState<"parents" | "professionals" | "centres">("parents");
  const [specialty, setSpecialty] = useState("");
  const [city, setCity] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [availability, setAvailability] = useState("");
  const [, setLocation] = useLocation();

  const profCount = useCountUp(2400);
  const centreCount = useCountUp(380);
  const childCount = useCountUp(12000);

  if (isSignedIn) return <Redirect to="/dashboard" />;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (specialty) params.set("specialty", specialty);
    if (city) params.set("city", city);
    if (ageGroup) params.set("age", ageGroup);
    if (availability) params.set("mode", availability);
    setLocation(`/search?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-white">

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#dff2ec] via-[#f7fbf9] to-[#f9f5ee] py-24 px-4">
        {/* SVG background pattern */}
        <svg
          className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="rg1" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#5bbfa0" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#5bbfa0" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="10%" cy="20%" r="180" fill="url(#rg1)" />
          <circle cx="85%" cy="15%" r="120" fill="#a7dfd0" fillOpacity="0.12" />
          <circle cx="70%" cy="80%" r="200" fill="#f4c89c" fillOpacity="0.10" />
          <circle cx="20%" cy="75%" r="140" fill="#b5e5d4" fillOpacity="0.14" />
          <ellipse cx="50%" cy="50%" rx="320" ry="160" fill="#e4f5ef" fillOpacity="0.08" />
          <circle cx="35%" cy="35%" r="60" fill="#fde9d4" fillOpacity="0.20" />
          <circle cx="78%" cy="55%" r="80" fill="#c9ede0" fillOpacity="0.15" />
        </svg>

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/70 backdrop-blur-sm text-teal-700 rounded-full px-4 py-1.5 text-sm font-medium mb-6 border border-teal-200/60 shadow-sm">
            <Heart size={13} className="fill-teal-500 text-teal-500" />
            India's trusted special-needs platform
          </div>

          <h1 className="text-5xl sm:text-6xl font-serif font-semibold text-gray-900 mb-5 leading-[1.12] tracking-tight">
            Every child deserves<br />
            <span className="text-teal-600">the right support</span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto mb-10 leading-relaxed">
            Includly connects families across India with verified shadow teachers, occupational therapists,
            speech therapists, psychologists and therapy centres.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            <Link href="/sign-up?as=parent">
              <Button
                size="lg"
                className="bg-teal-600 hover:bg-teal-700 text-white gap-2 px-8 h-12 text-base shadow-md"
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
                className="border-2 border-gray-800 text-gray-800 hover:bg-gray-800 hover:text-white gap-2 px-8 h-12 text-base transition-colors"
                data-testid="hero-professional-cta"
              >
                List Your Services
              </Button>
            </Link>
          </div>

          {/* Trust bar */}
          <div className="inline-flex flex-wrap justify-center gap-x-8 gap-y-3 bg-white/60 backdrop-blur-sm rounded-2xl px-8 py-4 border border-white/80 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-teal-700 font-serif tabular-nums">
                {profCount.toLocaleString()}+
              </span>
              <span className="text-sm text-gray-600">Professionals</span>
            </div>
            <div className="hidden sm:block w-px bg-gray-200" />
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-teal-700 font-serif tabular-nums">
                {centreCount.toLocaleString()}+
              </span>
              <span className="text-sm text-gray-600">Therapy Centres</span>
            </div>
            <div className="hidden sm:block w-px bg-gray-200" />
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-teal-700 font-serif tabular-nums">
                {childCount.toLocaleString()}+
              </span>
              <span className="text-sm text-gray-600">Children Supported</span>
            </div>
            <div className="hidden sm:block w-px bg-gray-200" />
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-teal-600" />
              <span className="text-sm font-medium text-gray-700">Verified & Safe</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── SEARCH BAR ── */}
      <section id="search" className="py-10 px-4 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-5xl mx-auto">
          <form onSubmit={handleSearch}>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <label className="sr-only">Specialty</label>
                <select
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  className="w-full h-12 pl-4 pr-10 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent appearance-none"
                >
                  {SPECIALTIES_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>

              <div className="relative flex-1">
                <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="City (e.g. Mumbai, Delhi)"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full h-12 pl-9 pr-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>

              <div className="relative">
                <label className="sr-only">Child's age group</label>
                <select
                  value={ageGroup}
                  onChange={(e) => setAgeGroup(e.target.value)}
                  className="h-12 pl-4 pr-10 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent appearance-none"
                >
                  {AGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>

              <div className="relative">
                <label className="sr-only">Availability</label>
                <select
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value)}
                  className="h-12 pl-4 pr-10 rounded-xl border border-gray-200 bg-gray-50 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent appearance-none"
                >
                  <option value="">Online / Offline</option>
                  <option value="online">Online only</option>
                  <option value="offline">In-person only</option>
                  <option value="both">Both</option>
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>

              <Button
                type="submit"
                className="h-12 px-8 bg-teal-600 hover:bg-teal-700 text-white rounded-xl gap-2 text-sm font-medium shrink-0"
                data-testid="search-submit"
              >
                <Search size={16} />
                Search
              </Button>
            </div>
          </form>

          {/* Quick chips */}
          <div className="flex flex-wrap gap-2 mt-4">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip.specialty}
                onClick={() => setLocation(`/search?specialty=${chip.specialty}`)}
                className="text-xs px-3 py-1.5 rounded-full border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors font-medium"
              >
                {chip.label}
              </button>
            ))}
            <button
              onClick={() => {
                navigator.geolocation?.getCurrentPosition(() => setLocation("/search?near=me"));
                setLocation("/search");
              }}
              className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 bg-gray-50 hover:bg-gray-100 transition-colors font-medium flex items-center gap-1"
            >
              <MapPin size={11} /> Near Me
            </button>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-20 px-4 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-serif font-semibold text-gray-900 mb-2">How it works</h2>
            <p className="text-gray-500 text-base">Getting started takes less than 5 minutes.</p>
          </div>

          {/* Tab switcher */}
          <div className="flex justify-center mb-12">
            <div className="inline-flex bg-white border border-gray-200 rounded-xl p-1 gap-1 shadow-sm">
              {(["parents", "professionals", "centres"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setHowTab(tab)}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                    howTab === tab
                      ? "bg-teal-600 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {tab === "parents" ? "For Parents" : tab === "professionals" ? "For Professionals" : "For Therapy Centres"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS[howTab].map((step) => (
              <div key={step.num} className="relative bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <div className="text-4xl font-serif font-bold text-teal-100 mb-3 leading-none">{step.num}</div>
                <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center mb-4">
                  {step.icon}
                </div>
                <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">{step.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CATEGORY GRID ── */}
      <section id="find-professionals" className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-serif font-semibold text-gray-900 mb-2">Find by category</h2>
            <p className="text-gray-500">Every specialist on Includly is background-checked and reviewed by parents like you.</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
            {CATEGORY_CARDS.map((card) => (
              <Link key={card.specialty} href={`/search?specialty=${card.specialty}`}>
                <div
                  className="group flex flex-col gap-3 p-6 bg-white border border-gray-100 rounded-2xl hover:shadow-md hover:-translate-y-1 transition-all duration-200 cursor-pointer"
                  data-testid={`category-${card.specialty}`}
                >
                  <div className={`w-12 h-12 ${card.bg} rounded-xl flex items-center justify-center`}>
                    {card.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm group-hover:text-teal-700 transition-colors">{card.title}</h3>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{card.desc}</p>
                  </div>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50">
                    <span className="text-xs text-gray-400">{card.count}+ listed</span>
                    <span className="text-xs text-teal-600 font-medium group-hover:translate-x-0.5 transition-transform">Browse →</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="py-20 px-4 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-serif font-semibold text-gray-900 mb-2">Trusted by families & professionals</h2>
            <p className="text-gray-500">Real stories from real people across India.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6 overflow-x-auto sm:overflow-visible pb-2">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="flex-shrink-0 w-[80vw] sm:w-auto bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex flex-col gap-4">
                <div className="flex gap-0.5">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <Star key={i} size={14} className="fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <Quote size={20} className="text-teal-200" />
                <p className="text-sm text-gray-700 leading-relaxed flex-1 italic">"{t.quote}"</p>
                <div className="flex items-center gap-3 pt-2 border-t border-gray-50">
                  <div className={`w-9 h-9 ${t.bg} rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                    {t.initials}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.role} · {t.city}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FREE BANNER ── */}
      <section className="py-14 px-4 bg-gradient-to-r from-teal-600 to-teal-500">
        <div className="max-w-3xl mx-auto text-center text-white">
          <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-1.5 text-sm font-medium mb-4 border border-white/30">
            <Sparkles size={13} />
            Launch Offer
          </div>
          <h2 className="text-2xl sm:text-3xl font-serif font-semibold mb-3 leading-snug">
            Includly is completely free for families.
          </h2>
          <p className="text-teal-100 text-base mb-2 max-w-xl mx-auto">
            Professionals list for free during our launch period. Join now and grow your reach with zero risk.
          </p>
          <p className="text-teal-200 text-xs mb-8">
            Monetisation will be enabled by admin when the platform is ready — you'll be notified in advance.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/sign-up?as=parent">
              <Button className="bg-white text-teal-700 hover:bg-gray-50 gap-2 px-8 h-11 font-semibold">
                Find Support for My Child
                <ArrowRight size={15} />
              </Button>
            </Link>
            <Link href="/sign-up?as=professional">
              <Button variant="outline" className="border-white/60 text-white hover:bg-white/10 gap-2 px-8 h-11">
                List Your Services
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-gray-900 text-gray-400 py-16 px-4">
        <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">In</span>
              </div>
              <span className="font-serif font-semibold text-lg text-white">Includly</span>
            </div>
            <p className="text-xs leading-relaxed mb-5 text-gray-500">
              India's trusted marketplace connecting families with verified special-education professionals.
            </p>
            <div className="flex gap-3">
              {[
                { icon: <Twitter size={15} />, href: "#" },
                { icon: <Instagram size={15} />, href: "#" },
                { icon: <Facebook size={15} />, href: "#" },
                { icon: <Linkedin size={15} />, href: "#" },
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

          {/* For Parents */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">For Parents</h4>
            <ul className="space-y-2.5 text-xs">
              {[
                { label: "Find Professionals", href: "/search" },
                { label: "How It Works", href: "/#how-it-works" },
                { label: "Reviews", href: "/search" },
                { label: "Support", href: "/support" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-teal-400 transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* For Professionals */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">For Professionals</h4>
            <ul className="space-y-2.5 text-xs">
              {[
                { label: "List Your Services", href: "/sign-up?as=professional" },
                { label: "Pricing", href: "/pricing" },
                { label: "Get Verified", href: "/sign-up?as=professional" },
                { label: "Professional Dashboard", href: "/dashboard" },
                { label: "Resources", href: "/support" },
              ].map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-teal-400 transition-colors">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
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
