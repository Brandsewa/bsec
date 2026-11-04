/**
 * State Pricing app, manual mode (ADR-044): asks the shopper for their pincode as soon as the store opens. A plain
 * HTML form post to /api/storefront/region, so it ships no client JavaScript (the product page JS budget has no
 * headroom). Shown to people only, never to crawlers; "Continue" keeps the standard prices.
 */
export function PincodeGate({ storeName, error }: { storeName: string; error?: string | null }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pincode-gate-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <form method="post" action="/api/storefront/region" className="w-full max-w-sm rounded-lg border border-border bg-background p-6 text-foreground shadow-lg">
        <h2 id="pincode-gate-title" className="text-lg font-semibold">
          Where should we deliver?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Enter your pincode to see the prices for your state at {storeName}.</p>
        <label htmlFor="pincode-gate-input" className="mt-4 block text-sm font-medium">
          Pincode
        </label>
        <input
          id="pincode-gate-input"
          name="pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          pattern="[1-9][0-9]{5}"
          maxLength={6}
          required
          autoFocus
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="6-digit pincode"
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="submit" name="skip" value="1" formNoValidate className="text-sm text-muted-foreground underline underline-offset-2">
            Continue with standard prices
          </button>
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            See prices
          </button>
        </div>
      </form>
    </div>
  );
}
