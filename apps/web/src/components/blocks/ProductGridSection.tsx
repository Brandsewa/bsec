import React from "react";
import { getCachedStorefrontFeaturedProducts } from "@/server/cached-storefront.ts";
import { ProductCard } from "@/components/catalog/ProductCard.tsx";

export interface ProductGridSectionProps {
  tenantId: string;
  props: { title: string; subtitle?: string | undefined; collectionSlug?: string | undefined; limit: number; columns: "2" | "3" | "4" };
}

// Tailwind needs whole class names at build time.
const COLUMNS: Record<"2" | "3" | "4", string> = {
  "2": "md:grid-cols-2",
  "3": "md:grid-cols-3",
  "4": "md:grid-cols-4",
};

/** The home page product grid with the store's real products (the block package itself has no data access). */
export async function ProductGridSection({ tenantId, props }: ProductGridSectionProps) {
  const products = await getCachedStorefrontFeaturedProducts(tenantId, props.limit, props.collectionSlug).catch(() => []);

  return (
    <section className="bs-block-product-grid mx-auto max-w-7xl px-4 py-12">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">{props.title}</h2>
        {props.subtitle && <p className="mt-2 text-muted">{props.subtitle}</p>}
      </div>
      {products.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted" data-testid="product-grid-empty">
          Products are on their way. Please check back soon.
        </p>
      ) : (
        <div className={`grid grid-cols-2 gap-6 ${COLUMNS[props.columns]}`} data-testid="product-grid">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </section>
  );
}
