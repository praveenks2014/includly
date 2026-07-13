/**
 * AntiBypassNotice — shared "stay on Includly" commit-time notice.
 *
 * Generalized from the inline block in ShadowTeacherRequestWidget.tsx
 * (commit dialog, ~line 1630) — same benefits-framing pattern, not a
 * behavior change, just parameterized so tutor/therapist can reuse it
 * without touching shadow-teacher's own file. True-benefits-only copy,
 * no penalty threats, per the agreed platformNotice tone used server-side.
 */
interface AntiBypassNoticeProps {
  professionalLabel: string; // "tutor" | "therapist"
  benefits: string[];
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Optional override for the checkbox label. Defaults to the original
   * parent-facing phrasing below — pass an explicit string when this
   * notice is shown to the professional themselves (they wouldn't say
   * "my tutor" about themselves). */
  checkboxLabel?: string;
}

export function AntiBypassNotice({ professionalLabel, benefits, checked, onCheckedChange, checkboxLabel }: AntiBypassNoticeProps) {
  return (
    <div className="space-y-2">
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-3.5 space-y-2">
        <p className="text-sm font-semibold text-teal-800">Includly&apos;s protections apply only to on-platform engagements</p>
        <p className="text-xs text-teal-700">By keeping this engagement on Includly, you keep:</p>
        <ul className="text-xs text-teal-700 space-y-1 list-disc pl-4">
          {benefits.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="text-xs text-teal-700">Taking the engagement off-platform after committing means these protections no longer apply.</p>
      </div>
      <label className="flex items-start gap-2 cursor-pointer text-xs text-[#1A2340]">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#2EC4A5] cursor-pointer"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          data-testid="commit-acknowledge-checkbox"
        />
        <span>{checkboxLabel ?? `I understand — I want to keep this engagement with my ${professionalLabel} on Includly`}</span>
      </label>
    </div>
  );
}
