import type { StorefrontMarket } from "@bs/domain";

const COUNTRY_NAMES: Record<string, string> = { IN: "India", US: "the United States", CA: "Canada" };

function selectHref(handle: string, next: string): string {
  return `/api/storefront/market/select?handle=${encodeURIComponent(handle)}&next=${encodeURIComponent(next)}`;
}

/**
 * Country and currency switcher, and the "shop in your currency?" suggestion (ADR-040). Server-rendered with a plain
 * <details> and links: no client JavaScript is added to storefront pages. Geography only ever suggests; it never changes a price.
 */
export function MarketBar({ markets, current, suggestion, path, country }: { markets: StorefrontMarket[]; current: StorefrontMarket; suggestion: StorefrontMarket | null; path: string; country: string | null }) {
  if (markets.length < 2) return null;
  return (
    <div className="border-b border-border bg-background text-sm text-foreground" data-testid="market-bar">
      {suggestion ? (
        <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-muted px-4 py-2">
          <span>
            {country && COUNTRY_NAMES[country] ? `Visiting from ${COUNTRY_NAMES[country]}? ` : ""}
            Shop in {suggestion.currency} ({suggestion.name}).
          </span>
          <a className="font-semibold underline" href={selectHref(suggestion.handle, path)}>
            Switch to {suggestion.name}
          </a>
          <a className="text-muted-foreground underline" href={selectHref(current.handle, path)}>
            No thanks
          </a>
        </div>
      ) : null}
      <div className="mx-auto flex max-w-7xl justify-end px-4 py-1.5 sm:px-6 lg:px-8">
        <details className="relative">
          <summary className="cursor-pointer list-none rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            {current.name} · {current.currency}
          </summary>
          <ul className="absolute right-0 z-50 mt-1 min-w-48 rounded-md border border-border bg-background p-1 shadow-md">
            {markets.map((m) => (
              <li key={m.id}>
                <a
                  href={selectHref(m.handle, path)}
                  aria-current={m.id === current.id ? "true" : undefined}
                  className={`block rounded px-3 py-1.5 text-xs hover:bg-muted ${m.id === current.id ? "font-semibold" : ""}`}
                >
                  {m.name} · {m.currency}
                </a>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
