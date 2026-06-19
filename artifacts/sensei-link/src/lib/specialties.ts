import {
  GraduationCap,
  BookOpen,
  Hand,
  MessageCircle,
  Brain,
  Baby,
  Activity,
  Building2,
  Waves,
  Music,
  Dumbbell,
  Trophy,
  Mic2,
  Palette,
  Flame,
  type LucideIcon,
} from "lucide-react";

export const SPECIALTY_LABELS: Record<string, string> = {
  shadow_teacher: "Shadow Teacher",
  special_tutor: "Special Educator",
  occupational_therapy: "Occupational Therapist",
  speech_therapy: "Speech Therapist",
  psychiatrist: "Psychiatrist",
  developmental_pediatrician: "Developmental Pediatrician",
  neurologist: "Neurologist",
  therapy_centre: "Therapy Centre",
  coaching: "Inclusive Coach",
};

export const SPECIALTY_OPTIONS = Object.entries(SPECIALTY_LABELS)
  .filter(([value]) => value !== "therapy_centre")
  .map(([value, label]) => ({ value, label }));

export function getSpecialtyLabel(specialty: string): string {
  return SPECIALTY_LABELS[specialty] ?? specialty;
}

export const SPECIALTY_COLORS: Record<string, string> = {
  shadow_teacher: "bg-blue-100 text-blue-800",
  special_tutor: "bg-violet-100 text-violet-800",
  occupational_therapy: "bg-teal-100 text-teal-800",
  speech_therapy: "bg-cyan-100 text-cyan-800",
  psychiatrist: "bg-indigo-100 text-indigo-800",
  developmental_pediatrician: "bg-emerald-100 text-emerald-800",
  neurologist: "bg-purple-100 text-purple-800",
  therapy_centre: "bg-rose-100 text-rose-800",
  coaching: "bg-orange-100 text-orange-800",
};

export const SPECIALTY_ICON_COLORS: Record<string, string> = {
  shadow_teacher: "text-blue-600 bg-blue-50",
  special_tutor: "text-violet-600 bg-violet-50",
  occupational_therapy: "text-teal-600 bg-teal-50",
  speech_therapy: "text-cyan-600 bg-cyan-50",
  psychiatrist: "text-indigo-600 bg-indigo-50",
  developmental_pediatrician: "text-emerald-600 bg-emerald-50",
  neurologist: "text-purple-600 bg-purple-50",
  therapy_centre: "text-rose-600 bg-rose-50",
  coaching: "text-orange-600 bg-orange-50",
};

export const SPECIALTY_ICONS: Record<string, LucideIcon> = {
  shadow_teacher: GraduationCap,
  special_tutor: BookOpen,
  occupational_therapy: Hand,
  speech_therapy: MessageCircle,
  psychiatrist: Brain,
  developmental_pediatrician: Baby,
  neurologist: Activity,
  therapy_centre: Building2,
  coaching: Trophy,
};

export const SPECIALTY_IN_PERSON_ONLY: Record<string, boolean> = {
  therapy_centre: true,
};

export function getSpecialtyIcon(specialty: string): LucideIcon {
  return SPECIALTY_ICONS[specialty] ?? GraduationCap;
}

export function isInPersonOnly(specialty: string): boolean {
  return SPECIALTY_IN_PERSON_ONLY[specialty] === true;
}

export const COACHING_SUB_TYPE_LABELS: Record<string, string> = {
  swimming: "Swimming",
  dance: "Dance",
  music: "Music",
  sports: "Sports",
  singing: "Singing",
  fitness: "Fitness",
  art: "Art",
  yoga: "Yoga",
};

export const COACHING_SUB_TYPE_OPTIONS = Object.entries(COACHING_SUB_TYPE_LABELS).map(
  ([value, label]) => ({ value, label })
);

export const COACHING_SUB_TYPE_ICONS: Record<string, LucideIcon> = {
  swimming: Waves,
  dance: Flame,
  music: Music,
  sports: Trophy,
  singing: Mic2,
  fitness: Dumbbell,
  art: Palette,
  yoga: Activity,
};

export function getCoachingSubTypeLabel(subType: string): string {
  return COACHING_SUB_TYPE_LABELS[subType] ?? subType;
}

export function getCoachingSubTypeIcon(subType: string): LucideIcon {
  return COACHING_SUB_TYPE_ICONS[subType] ?? Trophy;
}
