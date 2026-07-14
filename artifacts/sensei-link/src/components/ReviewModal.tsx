/**
 * ReviewModal — parent → professional rating (1-5 stars + optional comment).
 * Extracted from parent-dashboard.tsx's local ReviewModal (used there from
 * FindTab's general professional search results) so it can also be reused
 * from VerticalRequestWidget.tsx after a tutor/therapist trial completes
 * (D2) — same POST /ratings upsert endpoint, same StarRating component, no
 * new rating system.
 */
import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/StarRating";
import { useToast } from "@/hooks/use-toast";
import { useCreateRating } from "@workspace/api-client-react";

export function ReviewModal({ professionalId, onClose }: { professionalId: number; onClose: () => void }) {
  const { toast } = useToast();
  const { mutateAsync: createRating, isPending } = useCreateRating();
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState("");

  async function submit() {
    try {
      await createRating({ data: { professionalId, score: stars, comment: review.trim() || undefined } });
      toast({ title: "Review submitted!" });
      onClose();
    } catch {
      toast({ title: "Could not submit review", variant: "destructive" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Leave a review</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="mb-4">
          <StarRating value={stars} onChange={setStars} interactive />
        </div>
        <textarea
          className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400"
          rows={3}
          placeholder="Share your experience…"
          value={review}
          onChange={(e) => setReview(e.target.value)}
        />
        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={submit} disabled={isPending}>
            {isPending ? <Loader2 size={14} className="animate-spin" /> : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
