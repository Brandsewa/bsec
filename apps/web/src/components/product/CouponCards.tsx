import type { StorefrontCoupon } from "@bs/domain";
import { CouponCopy } from "./CouponCopy.tsx";
import { CouponDrawer } from "./CouponDrawer.tsx";

/**
 * One coupon as a card, three evenly spaced rows: what it gives (left) with the end date (right); the description; the code with its
 * copy button.
 */
function CouponCard({ coupon }: { coupon: StorefrontCoupon }) {
  const description = [coupon.title, coupon.condition].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--color-foreground,#0f172a)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-primary,#0f172a)_6%,transparent)] p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="text-sm font-bold leading-tight text-foreground">{coupon.benefit}</p>
        {coupon.endsAt ? (
          <p className="whitespace-nowrap text-[10px] text-muted-foreground">Ends {new Date(coupon.endsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
        ) : null}
      </div>
      {description ? <p className="text-[11px] leading-snug text-muted-foreground">{description}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <code className="min-w-0 break-all rounded bg-background px-1.5 py-0.5 text-xs font-bold text-foreground">{coupon.code}</code>
        <span className="shrink-0">
          <CouponCopy code={coupon.code}>
            <svg className="bs-copy-icon h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V6a2 2 0 0 1 2-2h9" />
            </svg>
            <svg className="bs-copy-done h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </CouponCopy>
        </span>
      </div>
    </div>
  );
}

/** The first coupons as compact cards (two per row on every screen size), with a "View all" button that opens a side drawer listing every one. Server component. */
export function CouponCards({
  coupons,
  title,
  showCount,
  showViewAll,
  viewAllLabel,
  inline = false,
}: {
  inline?: boolean;
  coupons: StorefrontCoupon[];
  title: string;
  showCount: number;
  showViewAll: boolean;
  viewAllLabel: string;
}) {
  if (coupons.length === 0) return null;
  const shown = coupons.slice(0, showCount);

  return (
    <section className={inline ? "bs-skin w-full" : "bs-skin mx-auto w-full max-w-[80rem] px-4 py-3"} aria-label={title || "Coupons"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        {title ? <h3 className="text-base font-semibold text-foreground">{title}</h3> : <span />}
        {showViewAll ? (
          <CouponDrawer label={`${viewAllLabel || "View all"}${coupons.length > shown.length ? ` (${coupons.length})` : ""}`}>
            {coupons.map((c) => (
              <CouponCard key={c.code} coupon={c} />
            ))}
          </CouponDrawer>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {shown.map((c) => (
          <CouponCard key={c.code} coupon={c} />
        ))}
      </div>
    </section>
  );
}
