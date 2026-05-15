import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BookOpen, Clock, ArrowRight, Users, Stethoscope, FileText, Heart, Lightbulb, MessageCircle } from "lucide-react";

type Category = "all" | "parents" | "professionals" | "diagnosis" | "iep" | "therapy" | "community";

interface Article {
  id: string;
  title: string;
  category: Category;
  excerpt: string;
  readTime: number;
  date: string;
  author: string;
  tag: string;
}

const ARTICLES: Article[] = [
  {
    id: "1",
    title: "Understanding Your Child's IEP: A Step-by-Step Guide for Indian Parents",
    category: "iep",
    excerpt: "Navigating an Individualised Education Plan can feel overwhelming. This guide walks you through every section — goals, accommodations, and how to advocate effectively in school meetings.",
    readTime: 8,
    date: "2026-04-10",
    author: "Priya Nair, Special Educator",
    tag: "IEP Help",
  },
  {
    id: "2",
    title: "Early Signs of Autism Spectrum Disorder: What to Look For at Ages 1–3",
    category: "diagnosis",
    excerpt: "Early intervention makes a measurable difference. Learn the developmental milestones to watch, red flags to note, and how to approach a formal assessment with a developmental pediatrician.",
    readTime: 6,
    date: "2026-03-28",
    author: "Dr. Ananya Sharma, Developmental Pediatrician",
    tag: "Diagnosis",
  },
  {
    id: "3",
    title: "Sensory Processing and the Classroom: Tips for Shadow Teachers",
    category: "professionals",
    excerpt: "When a child experiences sensory overload, the classroom can become a challenging environment. This article covers practical strategies shadow teachers can use to support regulation.",
    readTime: 7,
    date: "2026-04-02",
    author: "Rohan Mehta, Occupational Therapist",
    tag: "For Professionals",
  },
  {
    id: "4",
    title: "Finding Affordable Therapy in Tier-2 Indian Cities",
    category: "parents",
    excerpt: "Access to quality special education support isn't limited to metros. Here's how families in cities like Indore, Coimbatore, and Patna can find verified professionals without breaking the bank.",
    readTime: 5,
    date: "2026-03-15",
    author: "Includly Team",
    tag: "For Parents",
  },
  {
    id: "5",
    title: "Speech Therapy at Home: 10 Activities You Can Do Between Sessions",
    category: "therapy",
    excerpt: "Consistency between formal sessions accelerates progress. Speech therapist Meenakshi Iyer shares easy, fun activities using everyday objects that parents can practice with their child daily.",
    readTime: 9,
    date: "2026-04-18",
    author: "Meenakshi Iyer, Speech Therapist",
    tag: "Therapy Tips",
  },
  {
    id: "6",
    title: "Our Journey with ADHD: How We Found the Right Support",
    category: "community",
    excerpt: "Sunita's son was 6 when he was diagnosed with ADHD. Three years later, she shares the professionals who helped, the resources that worked, and the community that kept her going.",
    readTime: 6,
    date: "2026-04-05",
    author: "Sunita Kapoor, Parent",
    tag: "Community Story",
  },
  {
    id: "7",
    title: "ABA Therapy in India: What Parents Need to Know Before Starting",
    category: "therapy",
    excerpt: "Applied Behaviour Analysis has strong evidence behind it — but implementation varies widely. This guide covers what to look for in an ABA therapist, session structure, and red flags to avoid.",
    readTime: 10,
    date: "2026-03-22",
    author: "Dr. Kavitha Rao, Behaviour Analyst",
    tag: "Therapy Tips",
  },
  {
    id: "8",
    title: "How to Document Your Child's Progress for School Meetings",
    category: "iep",
    excerpt: "Detailed records make you a more effective advocate. Learn which observations to track, how to organise them, and how to present data constructively to your child's school team.",
    readTime: 5,
    date: "2026-04-22",
    author: "Includly Team",
    tag: "IEP Help",
  },
];

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "all", label: "All Resources", icon: <BookOpen size={16} />, color: "bg-[#2EC4A5]/10 text-[#2EC4A5] border-[#2EC4A5]/20" },
  { id: "parents", label: "For Parents", icon: <Users size={16} />, color: "bg-blue-50 text-blue-700 border-blue-200" },
  { id: "professionals", label: "For Professionals", icon: <Stethoscope size={16} />, color: "bg-violet-50 text-violet-700 border-violet-200" },
  { id: "diagnosis", label: "Diagnosis Guides", icon: <FileText size={16} />, color: "bg-orange-50 text-orange-700 border-orange-200" },
  { id: "iep", label: "IEP Help", icon: <Lightbulb size={16} />, color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  { id: "therapy", label: "Therapy Tips", icon: <Heart size={16} />, color: "bg-rose-50 text-rose-700 border-rose-200" },
  { id: "community", label: "Community Stories", icon: <MessageCircle size={16} />, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
];

function getCategoryMeta(cat: Category) {
  return CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0];
}

function ArticleSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] animate-pulse">
      <div className="h-4 w-24 bg-gray-200 rounded-full mb-4" />
      <div className="h-6 w-3/4 bg-gray-200 rounded mb-3" />
      <div className="h-4 w-full bg-gray-100 rounded mb-2" />
      <div className="h-4 w-5/6 bg-gray-100 rounded mb-6" />
      <div className="flex items-center gap-3">
        <div className="h-3 w-20 bg-gray-100 rounded" />
        <div className="h-3 w-16 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [loading] = useState(false);

  const filtered = activeCategory === "all"
    ? ARTICLES
    : ARTICLES.filter((a) => a.category === activeCategory);

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#1A2340] to-[#2a3660] text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 text-[#2EC4A5] text-sm font-semibold mb-4 uppercase tracking-widest">
              <BookOpen size={14} />
              Resources &amp; Support
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl font-bold leading-tight mb-4">
              Knowledge to help your child thrive
            </h1>
            <p className="text-white/70 text-lg leading-relaxed">
              Curated guides, therapy tips, and real family stories — everything you need to navigate special education in India with confidence.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar filters — desktop */}
          <aside className="hidden lg:block w-56 shrink-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3 px-1">Categories</p>
            <nav className="space-y-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  aria-label={`Filter by ${cat.label}`}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-[#2EC4A5] ${
                    activeCategory === cat.id
                      ? "bg-[#2EC4A5] text-white shadow-sm"
                      : "text-gray-600 hover:bg-white hover:shadow-sm"
                  }`}
                >
                  {cat.icon}
                  {cat.label}
                </button>
              ))}
            </nav>

            <div className="mt-8 p-4 bg-white rounded-xl border border-gray-100 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
              <p className="text-sm font-semibold text-[#1A2340] mb-1">Join our community</p>
              <p className="text-xs text-gray-500 mb-3">Connect with other parents on our upcoming forum.</p>
              <Link href="/forum">
                <Button size="sm" className="w-full text-xs bg-[#FF6B6B] hover:bg-[#ff5252] border-0" aria-label="Join forum waitlist">
                  Join Forum →
                </Button>
              </Link>
            </div>
          </aside>

          <main className="flex-1 min-w-0">
            {/* Mobile category tabs */}
            <div className="lg:hidden flex gap-2 overflow-x-auto pb-3 mb-6 -mx-4 px-4 scrollbar-none">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  aria-label={`Filter by ${cat.label}`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all focus-visible:ring-2 focus-visible:ring-[#2EC4A5] ${
                    activeCategory === cat.id
                      ? "bg-[#2EC4A5] text-white border-[#2EC4A5]"
                      : "bg-white text-gray-600 border-gray-200"
                  }`}
                >
                  {cat.icon}
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Heading */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-serif text-2xl font-bold text-[#1A2340]">
                  {getCategoryMeta(activeCategory).label}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">{filtered.length} article{filtered.length !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* Articles grid */}
            {loading ? (
              <div className="grid sm:grid-cols-2 gap-6">
                {[1,2,3,4].map((i) => <ArticleSkeleton key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none" className="mb-5 opacity-50">
                  <rect width="80" height="80" rx="40" fill="#2EC4A5" fillOpacity="0.1"/>
                  <path d="M25 55V28a3 3 0 013-3h24a3 3 0 013 3v27l-15-8-15 8z" stroke="#2EC4A5" strokeWidth="2.5" strokeLinejoin="round"/>
                  <path d="M33 33h14M33 39h10" stroke="#2EC4A5" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
                <p className="font-serif text-xl font-semibold text-[#1A2340] mb-2">No articles yet</p>
                <p className="text-gray-500 text-sm max-w-xs">We're adding more content to this category soon. Check back shortly!</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-6">
                {filtered.map((article) => {
                  const catMeta = getCategoryMeta(article.category);
                  return (
                    <article
                      key={article.id}
                      className="bg-white rounded-xl border border-gray-100 p-6 shadow-[0_4px_24px_rgba(26,35,64,0.08)] hover:shadow-[0_8px_40px_rgba(26,35,64,0.12)] transition-shadow flex flex-col"
                    >
                      <span className={`self-start inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border mb-4 ${catMeta.color}`}>
                        {catMeta.icon}
                        {article.tag}
                      </span>
                      <h3 className="font-serif text-base font-semibold text-[#1A2340] leading-snug mb-2 flex-1">
                        {article.title}
                      </h3>
                      <p className="text-sm text-gray-600 leading-relaxed mb-4 line-clamp-3">
                        {article.excerpt}
                      </p>
                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-50">
                        <div className="text-xs text-gray-400 flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {article.readTime} min read
                          </span>
                          <span>{new Date(article.date).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-[#2EC4A5] hover:text-[#2EC4A5] hover:bg-[#2EC4A5]/10 gap-1 -mr-2 focus-visible:ring-2 focus-visible:ring-[#2EC4A5]"
                          aria-label={`Read more: ${article.title}`}
                        >
                          Read More
                          <ArrowRight size={12} />
                        </Button>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">By {article.author}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
