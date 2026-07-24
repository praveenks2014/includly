export interface RazorpayOrderOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayPaymentResponse) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  method?: {
    upi?: boolean;
    card?: boolean;
    netbanking?: boolean;
    wallet?: boolean;
    emi?: boolean;
    paylater?: boolean;
  };
  // Test-mode-only: forces the UPI "Collect" (enter VPA) sub-flow to be
  // shown alongside QR/Intent, so success@razorpay/failure@razorpay can be
  // used without a real UPI app. Only ever spread in when the server has
  // confirmed rzp_test_ keys are in use (see UpiVerificationOrder.testMode)
  // — never constructed unconditionally by the client.
  config?: {
    display: {
      blocks: Record<string, { name: string; instruments: { method: string; flows: string[] }[] }>;
      sequence: string[];
      preferences: { show_default_blocks: boolean };
    };
  };
}

export interface RazorpaySubscriptionOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  handler: (response: RazorpaySubscriptionResponse) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}

export type RazorpayOptions = RazorpayOrderOptions | RazorpaySubscriptionOptions;

export interface RazorpayInstance {
  open(): void;
}

export interface RazorpayPaymentResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpaySubscriptionResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

/**
 * Test-mode-only Checkout config for a UPI-only payment: explicitly lists
 * "collect" (enter VPA) alongside "qr"/"intent" so success@razorpay /
 * failure@razorpay can be used in Test Mode without a real UPI app or QR
 * scanner. Callers must only spread this in when the server has confirmed
 * test-mode keys are active (e.g. a UpiVerificationOrder's `testMode`
 * field) — never construct it unconditionally.
 */
export function buildUpiTestCheckoutConfig(): NonNullable<RazorpayOrderOptions["config"]> {
  return {
    display: {
      blocks: {
        upi: { name: "Pay via UPI", instruments: [{ method: "upi", flows: ["collect", "qr", "intent"] }] },
      },
      sequence: ["block.upi"],
      preferences: { show_default_blocks: false },
    },
  };
}

export function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function formatRupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}
