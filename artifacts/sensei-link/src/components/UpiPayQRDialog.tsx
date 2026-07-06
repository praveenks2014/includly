import QRCode from "react-qr-code";
import { CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface UpiPayQRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vpa: string;
  teacherName: string;
  amountInr: number;
  note: string;
  txnRef: string;
  submitting: boolean;
  onPaidConfirm: () => void | Promise<void>;
}

function buildUpiIntent({
  vpa, teacherName, amountInr, note, txnRef,
}: {
  vpa: string; teacherName: string; amountInr: number; note: string; txnRef: string;
}): string {
  const parts = [
    `pa=${encodeURIComponent(vpa)}`,
    `pn=${encodeURIComponent(teacherName)}`,
    `am=${amountInr.toString()}`,
    `cu=INR`,
    `tn=${encodeURIComponent(note)}`,
    `tr=${encodeURIComponent(txnRef)}`,
  ];
  return `upi://pay?${parts.join("&")}`;
}

export function UpiPayQRDialog({
  open, onOpenChange, vpa, teacherName, amountInr, note, txnRef, submitting, onPaidConfirm,
}: UpiPayQRDialogProps) {
  const { toast } = useToast();
  const intentUri = buildUpiIntent({ vpa, teacherName, amountInr, note, txnRef });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#1A2340]">Pay {teacherName} directly</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-sm text-orange-800">
            Send <strong>₹{amountInr.toLocaleString("en-IN")}</strong> via UPI directly to your teacher.
            The platform does not hold this payment.
          </div>

          <div className="bg-white border-2 border-gray-100 rounded-xl p-4 flex flex-col items-center gap-2">
            <div className="p-2 bg-white">
              <QRCode value={intentUri} size={192} level="M" />
            </div>
            <p className="text-[11px] text-gray-500 text-center px-2">
              Scan with any UPI app (GPay, PhonePe, Paytm, BHIM) to pay ₹{amountInr.toLocaleString("en-IN")} to {teacherName}
            </p>
          </div>

          <a
            href={intentUri}
            className="flex items-center justify-center gap-2 w-full h-10 rounded-xl bg-[#2EC4A5] hover:bg-[#28B090] text-white font-semibold text-sm no-underline"
            data-testid="upi-deeplink"
          >
            <ExternalLink size={14} />
            Open in UPI app
          </a>

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Teacher&apos;s UPI ID</p>
              <p className="text-sm font-mono font-semibold text-[#1A2340] truncate">{vpa}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg text-xs shrink-0"
              onClick={() => {
                void navigator.clipboard.writeText(vpa);
                toast({ title: "UPI ID copied" });
              }}
            >
              <Copy size={12} className="mr-1" />
              Copy
            </Button>
          </div>

          <p className="text-xs text-gray-500">
            Once you&apos;ve sent the payment via your UPI app, tap confirm below.
          </p>
        </div>

        <DialogFooter className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white rounded-xl gap-1"
            disabled={submitting}
            onClick={() => void onPaidConfirm()}
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            I&apos;ve Paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
