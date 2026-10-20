import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedStorefrontProduct } from "@/server/cached-storefront.ts";

/**
 * What the product carousel's quick-buy popup needs for one product: picture, short description and every variant with
 * its price and stock. The popup only chooses a variant; the add-to-cart call prices it on the server as always.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await ctx.params;
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return NextResponse.json({ error: "Store not found" }, { status: 404 });

    const product = await getCachedStorefrontProduct(access.tenantId, slug);
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const variants = (product.variants ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      optionValues: (v.optionValues as Record<string, string> | null) ?? {},
      price: v.price,
      ...(v.compareAtPrice !== undefined ? { compareAtPrice: v.compareAtPrice } : {}),
      inStock: v.stockStatus !== "out_of_stock" || Boolean(v.preorderEnabled),
    }));

    // Option definitions, or worked out from the variants when a product has none stored.
    let options = (product.options ?? []).map((o) => ({ name: o.name, values: o.values }));
    if (options.length === 0 && variants.length > 1) {
      const byName = new Map<string, string[]>();
      for (const v of variants) {
        for (const [name, value] of Object.entries(v.optionValues)) {
          const values = byName.get(name) ?? [];
          if (!values.includes(value)) values.push(value);
          byName.set(name, values);
        }
      }
      options = [...byName.entries()].map(([name, values]) => ({ name, values }));
    }

    const image = product.media.find((m) => m.kind !== "video" && m.kind !== "document" && m.url);
    return NextResponse.json({
      title: product.title,
      slug: product.slug,
      imageUrl: image?.url,
      shortDescription: product.shortDescription ?? null,
      quickAdd: { inStock: variants.some((v) => v.inStock), options, variants },
    });
  } catch {
    return NextResponse.json({ error: "Could not load the product" }, { status: 500 });
  }
}
