// Relays a parent's reason-for-visit / assessment-document upload from the
// consultation mini-form (Psychiatrist/Developmental Pediatrician/Neurologist
// category tiles) through to the actual booking step in BookingWidget.tsx,
// which is where the real "notes"/"assessmentDocumentKey" fields on
// POST /sessions/book actually live. There's no shared component state
// across the mini-form -> search -> profile -> BookingWidget navigation
// chain, so sessionStorage is the relay — cleared once consumed or once
// stale, so it never silently bleeds into an unrelated later booking.
export const CONSULTATION_NOTES_STORAGE_KEY = "includly:pendingConsultationNotes";

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export interface PendingConsultationNotes {
  specialty: string;
  notes: string;
  mode: string;
  assessmentDocumentKey?: string;
  createdAt: number;
}

export function writePendingConsultationNotes(data: Omit<PendingConsultationNotes, "createdAt">): void {
  const payload: PendingConsultationNotes = { ...data, createdAt: Date.now() };
  sessionStorage.setItem(CONSULTATION_NOTES_STORAGE_KEY, JSON.stringify(payload));
}

// Only returns a match for the given specialty, and only if still fresh —
// a stale or mismatched entry is treated as absent, not partially reused.
export function readPendingConsultationNotes(specialty: string): PendingConsultationNotes | null {
  const raw = sessionStorage.getItem(CONSULTATION_NOTES_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingConsultationNotes;
    if (parsed.specialty !== specialty) return null;
    if (Date.now() - parsed.createdAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingConsultationNotes(): void {
  sessionStorage.removeItem(CONSULTATION_NOTES_STORAGE_KEY);
}
