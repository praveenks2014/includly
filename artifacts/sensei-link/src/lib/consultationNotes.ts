// Relays a parent's reason-for-visit text from the consultation mini-form
// (Psychiatrist/Developmental Pediatrician/Neurologist category tiles)
// through to the actual booking step in BookingWidget.tsx, which is where
// the real "notes" field on POST /sessions/book actually lives. There's no
// shared component state across the mini-form -> search -> profile ->
// BookingWidget navigation chain, so sessionStorage is the relay — cleared
// once consumed or once stale, so it never silently bleeds into an
// unrelated later booking.
//
// Text only, deliberately — a file-upload variant of this (an
// assessmentDocumentKey alongside notes) was built and then fully reverted
// (see commit history): it shipped without the compliance sign-off
// (retention policy, correctly-scoped access, encryption decision) the
// original design brief required before any real document upload. If file
// upload is wanted again, it needs that sign-off as its own dedicated,
// explicitly-approved task — not folded back in here quietly.
export const CONSULTATION_NOTES_STORAGE_KEY = "includly:pendingConsultationNotes";

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export interface PendingConsultationNotes {
  specialty: string;
  notes: string;
  mode: string;
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
