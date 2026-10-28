"use client";

import { useState } from "react";

/** The copy icon button on a coupon card: copies the code and shows a tick for a moment (the icons are passed in; `.bs-copy` in globals.css swaps them). */
export function CouponCopy({ code, children }: { code: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      aria-label={copied ? "Copied" : `Copy code ${code}`}
      data-copied={copied}
      className="bs-copy"
    >
      {children}
    </button>
  );
}
