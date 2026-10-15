import React from "react";

const STAR = "M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z";

function Stars({ className }: { className: string }) {
  return (
    <span className={`flex ${className}`} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} className="h-4 w-4 shrink-0 fill-current" viewBox="0 0 20 20">
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

/**
 * Review summary shown above the product title: the average as stars (partly filled, so 4.3 looks like 4.3), the number and the
 * review count, linking to the reviews section lower on the page. Without any review there is nothing to show, so it renders nothing.
 */
export function RatingSummary({ average, count }: { average: number | string; count: number }) {
  if (!(count > 0)) return null;
  const avg = Math.max(0, Math.min(5, Number(average) || 0));
  const fill = `${(avg / 5) * 100}%`;
  return (
    <a href="#reviews-section" className="inline-flex items-center gap-2 text-sm hover:underline" data-testid="rating-summary">
      <span className="relative inline-flex" role="img" aria-label={`Rated ${avg.toFixed(1)} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`}>
        <Stars className="text-muted-foreground/30" />
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: fill }}>
          <Stars className="text-amber-500" />
        </span>
      </span>
      <span className="font-semibold text-foreground">{avg.toFixed(1)}</span>
      <span className="text-muted-foreground">
        ({count} {count === 1 ? "review" : "reviews"})
      </span>
    </a>
  );
}
