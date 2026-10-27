import type { StorefrontCoupon } from "@bs/domain";
import { CouponCopy } from "./CouponCopy.tsx";
import { CouponDrawer } from "./CouponDrawer.tsx";

/** One coupon as a card: what it gives, when it applies, and the code with a copy button. */
function CouponCard({ coupon }: { coupon: StorefrontCoupon }) {
  return (
    <div className="rounded-xl border border-dashed border-[color-mix(in_srgb,var(--color-foreground,#0f172a)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-primary,#0f172a)_6%,transparent)] p-3.5">
      <p className="text-sm font-bold text-foreground">{coupon.benefit}</p>
      {coupon.title ? <p className="text-xs text-muted-foreground">{coupon.title}</p> : null}
      {coupon.condition ? <p className="mt-0.5 text-xs text-muted-foreground">{coupon.condition}</p> : null}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <code className="rounded bg-background px-2 py-1 text-sm font-bold tracking-wider text-foreground">{coupon.code}</code>
        <CouponCopy code={coupon.code} />
      </div>
      {coupon.endsAt ? <p className="mt-1.5 text-[11px] text-muted-foreground">Ends {new Date(coupon.endsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p> : null}
    </div>
  );
}

/** The first coupons as cards (two per row from tablet up), with a "View all" button that opens a side drawer listing every one. Server component. */
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shown.map((c) => (
          <CouponCard key={c.code} coupon={c} />
        ))}
      </div>
    </section>
  );
}
