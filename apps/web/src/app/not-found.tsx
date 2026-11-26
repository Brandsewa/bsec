import React, { Suspense } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_PAGES } from "@bs/blocks";
import { evaluateStorefrontAccess } from "@bs/domain";
// buttonVariants, not the client <Button>: the root not-found boundary ships with every route, so a client Button here put
// Base UI, tailwind-merge and the spinner icon into the product page bundle (50 KB budget, apps/web/test/perf-budget-bundle).
import { buttonVariants } from "@bs/ui/server";
import { server } from "@/server/runtime.ts";
import { getCachedDefaultPages } from "@/server/cached-storefront.ts";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/** Storefront 404: a way back (home, all collections) and a search box, in the store's theme. */
export default function NotFound() {
  return (
    <Suspense fallback={<NotFoundView copy={DEFAULT_PAGES.notFound} />}>
      <ThemedNotFound />
    </Suspense>
  );
}

async function ThemedNotFound() {
  let copy = DEFAULT_PAGES.notFound;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
    if (access.tenantId) copy = (await getCachedDefaultPages(access.tenantId)).notFound;
  } catch {
    // Not found must never fail: fall back to the built-in wording.
  }
  return <NotFoundView copy={copy} />;
}

function NotFoundView({ copy }: { copy: { heading: string; message: string } }) {
  return (
    <div className="bs-skin mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 lg:px-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">404</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{copy.heading}</h1>
      <p className="mt-3 text-base text-muted-foreground">{copy.message}</p>
      <form action="/search" method="get" role="search" className="mx-auto mt-8 flex max-w-md gap-2">
        <label htmlFor="nf-search" className="sr-only">
          Search the store
        </label>
        <input
          id="nf-search"
          name="q"
          type="search"
          placeholder="Search products"
          className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
        />
        <button type="submit" className={buttonVariants({ size: "lg" })}>
          Search
        </button>
      </form>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Home
        </Link>
        <Link href="/collections" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Browse collections
        </Link>
      </div>
    </div>
  );
}
