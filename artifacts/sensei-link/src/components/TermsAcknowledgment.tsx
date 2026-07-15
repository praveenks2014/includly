/**
 * Shared terms-of-engagement acknowledgment — shown to the parent at commit
 * and to the teacher at accept for a shadow-teacher engagement. Same body
 * copy both sides; each side supplies the live values it actually has at
 * that moment (the parent commits before a schedule exists — the teacher
 * supplies that at accept — so scheduleSummary is optional here).
 *
 * This is a record of agreed terms, not a binding legal contract.
 */
import { Checkbox } from "@/components/ui/checkbox";

export function TermsAcknowledgment({
  scheduleSummary,
  monthlyFeeLabel,
  startDate,
  noticePeriodDays,
  checked,
  onCheckedChange,
}: {
  scheduleSummary?: string | null;
  /** Pre-formatted, e.g. "₹18,000" (teacher's final figure) or "₹15,000–₹20,000 (expected)" (parent's pre-commit range). */
  monthlyFeeLabel: string;
  startDate: string;
  noticePeriodDays?: number;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const formattedStart = new Date(startDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const notice = noticePeriodDays ?? 30;

  return (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
      <p className="text-xs font-bold text-[#1A2340]">Terms of Engagement</p>
      <p className="text-[11px] text-gray-500">
        This is a record of what you've both agreed to on Includly — not a legal contract. It exists so there's a clear, timestamped account of the terms, alongside the identity verification already on file for both of you.
      </p>
      <div className="space-y-1.5 text-xs text-gray-700">
        {scheduleSummary ? (
          <p><span className="font-semibold">Schedule:</span> {scheduleSummary}</p>
        ) : (
          <p><span className="font-semibold">Schedule:</span> confirmed by the teacher when they accept</p>
        )}
        <p><span className="font-semibold">Monthly fee:</span> {monthlyFeeLabel}</p>
        <p><span className="font-semibold">Start date:</span> {formattedStart}</p>
      </div>
      <p className="text-[11px] text-gray-600">
        <span className="font-semibold">Ending this engagement:</span> Either of you can end this with {notice} days' notice, or by mutual early-exit agreement (buyout) — not by simply stopping without notice. Raise this through the app's "End Engagement" option so it's handled properly for both of you.
      </p>
      <div className="text-[11px] text-gray-600 space-y-1">
        <p className="font-semibold text-gray-700">If this engagement is abandoned without notice:</p>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li>Your identity is verified and on file — this isn't an anonymous arrangement.</li>
          <li>The other party can leave a public rating and review on your Includly profile, visible to future families/professionals.</li>
          <li>Includly may review the account and, where warranted, revoke verified status — which removes you from search and matching platform-wide.</li>
        </ul>
      </div>
      <label className="flex items-start gap-2 pt-1 cursor-pointer">
        <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} className="mt-0.5" aria-label="I agree to the terms of engagement" />
        <span className="text-xs text-gray-700">I've read and agree to the terms above.</span>
      </label>
    </div>
  );
}
