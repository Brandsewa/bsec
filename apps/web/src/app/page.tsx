import { Suspense } from "react";
import { connection } from "next/server";

/**
 * M0 placeholder. Demonstrates the storefront rendering model (PLAN §10, §12):
 * a static shell served instantly, with request-time parts inside Suspense + skeletons.
 * Host → tenant resolution and real blocks arrive in M1/M3.
 */
export default function Home() {
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold">Bs Commerce</span>
        <Suspense fallback={<span aria-hidden className="store-skeleton inline-block h-6 w-16" />}>
          <CartBadge />
        </Suspense>
      </header>
      <section className="grid gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Platform boots.</h1>
        <p className="text-base opacity-80">Milestone M0: storefront shell, Store API at /api, skeletons on every route.</p>
      </section>
    </main>
  );
}

/** Stand-in for the per-visitor cart badge: request-time, so it streams into its Suspense hole. */
async function CartBadge() {
  await connection();
  return (
    <span className="rounded-full bg-store-muted px-3 py-1 text-sm" aria-label="Cart, 0 items">
      Cart · 0
    </span>
  );
}
