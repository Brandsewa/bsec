"use client";

import { useEffect, useState } from "react";
import type { StorefrontCoupon } from "@bs/domain";

/** One coupon as a card: what it gives, when it applies, and the code with a copy button. */
function CouponCard({ coupon }: { coupon: StorefrontCoupon }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(coupon.code);
    } catch {
      // Clipboard blocked (older browser, insecure page): select the text through a temporary field instead.
      const el = document.createElement("textarea");
      el.value = coupon.code;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="rounded-xl border border-dashed border-[color-mix(in_srgb,var(--color-foreground,#0f172a)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-primary,#0f172a)_6%,transparent)] p-3.5">
      <p className="text-sm font-bold text-foreground">{coupon.benefit}</p>
      {coupon.title ? <p className="text-xs text-muted-foreground">{coupon.title}</p> : null}
      {coupon.condition ? <p className="mt-0.5 text-xs text-muted-foreground">{coupon.condition}</p> : null}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <code className="rounded bg-background px-2 py-1 text-sm font-bold tracking-wider text-foreground">{coupon.code}</code>
        <button type="button" onClick={() => void copy()} aria-label={`Copy code ${coupon.code}`} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {coupon.endsAt ? <p className="mt-1.5 text-[11px] text-muted-foreground">Ends {new Date(coupon.endsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p> : null}
    </div>
  );
}

/** The first coupons as cards, with a "View all" button that opens a side drawer listing every one. */
export function CouponCards({ coupons, title, showCount, showViewAll, viewAllLabel, inline = false }: { inline?: boolean; coupons: StorefrontCoupon[]; title: string; showCount: number; showViewAll: boolean; viewAllLabel: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (coupons.length === 0) return null;
  const shown = coupons.slice(0, showCount);

  return (
    <section className={inline ? "bs-skin w-full" : "bs-skin mx-auto w-full max-w-[80rem] px-4 py-3"} aria-label={title || "Coupons"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        {title ? <h3 className="text-base font-semibold text-foreground">{title}</h3> : <span />}
        {showViewAll && coupons.length > 0 ? (
          <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-foreground underline underline-offset-4">
            {viewAllLabel || "View all"}
            {coupons.length > shown.length ? ` (${coupons.length})` : ""}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shown.map((c) => (
          <CouponCard key={c.code} coupon={c} />
        ))}
      </div>

      {open ? (
        <div className="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-label="All coupons">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="bs-skin absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-background text-foreground shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-base font-semibold">Available coupons</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full px-2 py-1 text-xl leading-none hover:bg-muted">
                ×
              </button>
            </div>
            <div className="grid flex-1 content-start gap-3 overflow-y-auto p-4">
              {coupons.map((c) => (
                <CouponCard key={c.code} coupon={c} />
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
