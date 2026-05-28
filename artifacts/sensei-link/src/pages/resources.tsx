import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { Button } from "@/components/ui/button";
import {
  BookOpen, Clock, ArrowRight, Users, Stethoscope, FileText, Heart,
  Lightbulb, MessageCircle, Lock, Sparkles, PlayCircle, IndianRupee,
} from "lucide-react";
import { useGetResources, useGetPlusStatus } from "@workspace/api-client-react";

type Category = "all" | "parents" | "professionals" | "diagnosis" | "iep" | "therapy" | "community";

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "all",           label: "All Resources",     icon: <BookOpen size={16} />,      color: "bg-[#2EC4A5]/10 text-[#2EC4A5] border-[#2EC4A5]/20" },
  { id: "parents",       label: "For Parents",        icon: <Users size={16} />,         color: "bg-blue-50 text-blue-700 border-blue-200" },
  { id: "professionals", label: "For Professionals",  icon: <Stethoscope size={16} />,   color: "bg-violet-50 text-violet-700 border-violet-200" },
  { id: "diagnosis",     label: "Diagnosis Guides",   icon: <FileText size={16} />,      color: "bg-orange-50 text-orange-700 border-orange-200" },
  { id: "iep",           label: "IEP Help",           icon: <Lightbulb size={16} />,     color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  { id: "therapy",       label: "Therapy Tips",       icon: <Heart size={16} />,         color: "bg-rose-50 text-rose-700 border-rose-200" },
  { id: "community",     label: "Community Stories",  icon: <MessageCircle size={16} />, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
];

function getCategoryMeta(cat: string) {
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

function PlusUpsellBanner() {
  return (
    <div className="mt-8 p-5 bg-gradient-to-br from-[#1A2340] to-[#2a3660] rounded-xl text-white shadow-lg">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={16} className="text-[#FFB830]" />
        <span className="text-xs font-bold uppercase tracking-widest text-[#FFB830]">Includly Plus</span>
      </div>
      <p className="font-serif font-semibold text-base mb-1">Unlock all premium content</p>
      <p className="text-white/70 text-xs mb-3 leading-relaxed">
        Get unlimited access to expert guides, therapy tips, and in-depth resources.
      </p>
      <Link href="/pricing">
        <Button size="sm" className="w-full text-xs bg-[#2EC4A5] hover:bg-[#26a88d] border-0 font-semibold" aria-label="Upgrade to Includly Plus">
          Upgrade to Plus →
        </Button>
      </Link>
    </div>
  );
}

export default function ResourcesPage() {
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const { isSignedIn } = useAuth();

  const { data: resources = [], isLoading } = useGetResources(
    activeCategory === "all" ? undefined : activeCategory,
  );
  const { data: plusStatus } = useGetPlusStatus({ enabled: !!isSignedIn });
  const isPlus = plusStatus?.isPlus ?? false;

  const articles = resources.filter((r) => !r.isCourse);
  const courses = resources.filter((r) => r.isCourse);

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
              Curated guides, therapy tips, and real family stories. Premium deep-dives and mini-courses for{" "}
              <span className="text-[#FFB830] font-semibold">Includly Plus</span> members.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar — desktop */}
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

            {!isPlus && <PlusUpsellBanner />}

            {isPlus && (
              <div className="mt-8 p-4 bg-[#2EC4A5]/10 border border-[#2EC4A5]/30 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles size={14} className="text-[#2EC4A5]" />
                  <span className="text-xs font-bold text-[#2EC4A5]">Plus Active</span>
                </div>
                <p className="text-xs text-gray-600">You have full access to all premium content.</p>
              </div>
            )}

            <div className="mt-4 p-4 bg-white rounded-xl border border-gray-100 shadow-[0_4px_24px_rgba(26,35,64,0.08)]">
              <p className="text-sm font-semibold text-[#1A2340] mb-1">Have a question?</p>
              <p className="text-xs text-gray-500 mb-3">Ask our community of parents and verified experts.</p>
              <Link href="/forum">
                <Button size="sm" className="w-full text-xs bg-[#FF6B6B] hover:bg-[#ff5252] border-0" aria-label="Go to community Q&A">
                  Ask Community →
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

            {isLoading ? (
              <div className="grid sm:grid-cols-2 gap-6">
                {[1,2,3,4].map((i) => <ArticleSkeleton key={i} />)}
              </div>
            ) : (
              <>
                {/* Articles */}
                {articles.length > 0 && (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h2 className="font-serif text-2xl font-bold text-[#1A2340]">
                          {getCategoryMeta(activeCategory)?.label ?? "Articles"}
                        </h2>
                        <p className="text-sm text-gray-500 mt-0.5">{articles.length} article{articles.length !== 1 ? "s" : ""}</p>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6 mb-12">
                      {articles.map((article) => {
                        const catMeta = getCategoryMeta(article.category);
                        const locked = article.isPremium && !isPlus;
                        return (
                          <article
                            key={article.id}
                            className={`bg-white rounded-xl border p-6 flex flex-col transition-shadow ${
                              locked
                                ? "border-[#FFB830]/30 shadow-[0_4px_24px_rgba(26,35,64,0.06)]"
                                : "border-gray-100 shadow-[0_4px_24px_rgba(26,35,64,0.08)] hover:shadow-[0_8px_40px_rgba(26,35,64,0.12)]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-4">
                              <span className={`self-start inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${catMeta?.color ?? ""}`}>
                                {catMeta?.icon}
                                {article.tag}
                              </span>
                              {article.isPremium && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-[#FFB830]/15 text-[#b8860b] border border-[#FFB830]/30 shrink-0">
                                  <Sparkles size={10} />
                                  Plus
                                </span>
                              )}
                            </div>

                            <h3 className="font-serif text-base font-semibold text-[#1A2340] leading-snug mb-2 flex-1">
                              {article.title}
                            </h3>

                            {locked ? (
                              <>
                                <p className="text-sm text-gray-400 leading-relaxed mb-4 line-clamp-2 blur-[2px] select-none">
                                  {article.excerpt}
                                </p>
                                <div className="mt-auto pt-4 border-t border-gray-50">
                                  <Link href="/pricing">
                                    <Button
                                      size="sm"
                                      className="w-full gap-1.5 bg-[#FFB830] hover:bg-[#e6a500] text-white border-0 text-xs font-semibold"
                                      aria-label="Upgrade to read this article"
                                    >
                                      <Lock size={11} />
                                      Unlock with Plus
                                    </Button>
                                  </Link>
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="text-sm text-gray-600 leading-relaxed mb-4 line-clamp-3">
                                  {article.excerpt}
                                </p>
                                <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-50">
                                  <div className="text-xs text-gray-400 flex items-center gap-3">
                                    <span className="flex items-center gap-1">
                                      <Clock size={11} />
                                      {article.readTimeMinutes} min read
                                    </span>
                                    <span>{new Date(article.publishedAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}</span>
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
                              </>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Mini-courses */}
                {courses.length > 0 && (
                  <>
                    <div className="mb-6">
                      <h2 className="font-serif text-2xl font-bold text-[#1A2340]">Mini-Courses</h2>
                      <p className="text-sm text-gray-500 mt-0.5">Expert-led video courses — one-time purchase</p>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-6">
                      {courses.map((course) => (
                        <article
                          key={course.id}
                          className="bg-white rounded-xl border border-violet-100 p-6 flex flex-col shadow-[0_4px_24px_rgba(26,35,64,0.08)] hover:shadow-[0_8px_40px_rgba(26,35,64,0.12)] transition-shadow"
                        >
                          <div className="flex items-start justify-between gap-2 mb-4">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-violet-50 text-violet-700 border-violet-200">
                              <PlayCircle size={11} />
                              {course.tag}
                            </span>
                          </div>
                          <h3 className="font-serif text-base font-semibold text-[#1A2340] leading-snug mb-2 flex-1">
                            {course.title}
                          </h3>
                          <p className="text-sm text-gray-600 leading-relaxed mb-4 line-clamp-3">
                            {course.excerpt}
                          </p>
                          <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-50">
                            <div className="text-xs text-gray-400 flex items-center gap-1">
                              <Clock size={11} />
                              ~{course.readTimeMinutes} min
                            </div>
                            <div className="flex items-center gap-2">
                              {course.coursePricingInr && (
                                <span className="text-sm font-bold text-[#1A2340] flex items-center gap-0.5">
                                  <IndianRupee size={13} />
                                  {course.coursePricingInr}
                                </span>
                              )}
                              <Button
                                size="sm"
                                className="text-xs bg-violet-600 hover:bg-violet-700 text-white border-0 gap-1"
                                aria-label={`Enrol in ${course.title}`}
                              >
                                Enrol
                                <ArrowRight size={12} />
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-2">By {course.author}</p>
                        </article>
                      ))}
                    </div>
                  </>
                )}

                {articles.length === 0 && courses.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-20 h-20 bg-[#2EC4A5]/10 rounded-full flex items-center justify-center mb-5">
                      <BookOpen size={32} className="text-[#2EC4A5]" />
                    </div>
                    <p className="font-serif text-xl font-semibold text-[#1A2340] mb-2">No articles yet</p>
                    <p className="text-gray-500 text-sm max-w-xs">We're adding more content to this category soon.</p>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
