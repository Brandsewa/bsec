import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@bs/ui";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/** Storefront 404: a way back (home, all collections) and a search box, in the store's theme. */
export default function NotFound() {
  return (
    <div className="bs-skin mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 lg:px-8">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">404</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">We could not find that page</h1>
      <p className="mt-3 text-base text-muted-foreground">It may have moved or no longer exist. Try a search, or head back to the shop.</p>
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
        <Button type="submit" size="lg">
          Search
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild variant="outline" size="lg">
          <Link href="/">Home</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/collections">Browse collections</Link>
        </Button>
      </div>
    </div>
  );
}
