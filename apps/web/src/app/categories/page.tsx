import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedStorefrontCategories } from "@/server/cached-storefront.ts";

// Static on purpose: the root layout already sets robots and the canonical host for the store.
export const metadata: Metadata = {
  title: "Shop by category",
  description: "Browse every product category in the store.",
};

/** Categories archive: every category with products. The category counterpart of the collections archive. */
export default async function CategoriesArchivePage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
  if (!access.tenantId) return null;

  const categories = await getCachedStorefrontCategories(access.tenantId);

  return (
    <div className="bs-skin">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-3xl font-semibold tracking-tight">Shop by category</h1>
        <p className="mb-8 text-sm opacity-70">Find exactly what you are looking for.</p>

        {categories.length === 0 ? (
          <p className="py-16 text-center opacity-70">Products will appear here soon.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/categories/${c.slug}`}
                  className="group block overflow-hidden rounded-xl border border-current/10 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <div className="aspect-[4/3] w-full overflow-hidden bg-current/5">
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- storefront media is served from the store's own bucket
                      <img
                        src={c.imageUrl}
                        alt={c.imageAlt ?? c.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : null}
                  </div>
                  <div className="p-4">
                    <h2 className="text-lg font-medium">{c.name}</h2>
                    {c.description ? <p className="mt-1 line-clamp-2 text-sm opacity-70">{c.description}</p> : null}
                    <p className="mt-2 text-xs opacity-60">
                      {c.productCount} {c.productCount === 1 ? "product" : "products"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
