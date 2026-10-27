"use client";

import { useState } from "react";

/** The Copy button on a coupon card: copies the code and says so for a moment. */
export function CouponCopy({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      aria-label={`Copy code ${code}`}
      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
