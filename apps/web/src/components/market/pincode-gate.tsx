/**
 * State Pricing app, manual mode (ADR-044): asks the shopper for their pincode as soon as the store opens. A plain
 * HTML form post to /api/storefront/region, so it ships no client JavaScript (the product page JS budget has no
 * headroom). Shown to people only, never to crawlers. The card is a solid white surface on purpose: storefront theme
 * background tokens can be transparent, which let the page show through the popup.
 */
export function PincodeGate({ error }: { storeName?: string; error?: string | null }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pincode-gate-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <form method="post" action="/api/storefront/region" className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-xl">
        <h2 id="pincode-gate-title" className="text-lg font-semibold">
          Where should we deliver?
        </h2>
        <label htmlFor="pincode-gate-input" className="sr-only">
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
          className="mt-4 w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
          placeholder="Pincode"
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-4 w-full rounded-md px-4 py-2.5 text-sm font-medium"
          style={{ backgroundColor: "var(--color-primary, #111827)", color: "var(--color-primary-foreground, #ffffff)" }}
        >
          Continue
        </button>
        <p className="mt-3 text-center text-xs text-neutral-500">For delivery and availability</p>
      </form>
    </div>
  );
}
