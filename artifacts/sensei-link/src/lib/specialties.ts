export const SPECIALTY_LABELS: Record<string, string> = {
  shadow_teacher: "Shadow Teacher",
  special_tutor: "Special Tutor",
  occupational_therapy: "Occupational Therapy",
  speech_therapy: "Speech Therapy",
  psychiatrist: "Psychiatrist",
  developmental_pediatrician: "Developmental Pediatrician",
  neurologist: "Neurologist",
};

export const SPECIALTY_OPTIONS = Object.entries(SPECIALTY_LABELS).map(
  ([value, label]) => ({ value, label })
);

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
};
