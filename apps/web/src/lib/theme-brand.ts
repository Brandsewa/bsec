import { cleanSameAs } from "@bs/domain";

interface ChromePage {
  blocks: ReadonlyArray<{ type: string; props?: unknown }>;
  renderData?: { media?: Record<string, string> | undefined } | undefined;
}

/**
 * The store's logo and social profile links as the merchant set them in the theme's header and footer blocks. Most stores keep
 * their logo and social icons there rather than in Brand settings, so the Organization structured data reads them from the same
 * place (docs/SEO-GEO-AEO-PLAN.md Phase 2). Only https URLs are returned; mailto and other schemes are dropped.
 */
export function themeChromeIdentity(header: ChromePage | null | undefined, footer: ChromePage | null | undefined): { logoUrl: string | null; sameAs: string[] } {
  const logoOf = (page: ChromePage | null | undefined, type: string): string | null => {
    const block = page?.blocks.find((b) => b.type === type);
    const id = (block?.props as { logoMediaId?: unknown } | undefined)?.logoMediaId;
    const url = typeof id === "string" ? page?.renderData?.media?.[id] : undefined;
    return url && url.startsWith("https://") ? url : null;
  };
  const footerBlock = footer?.blocks.find((b) => b.type === "SiteFooter");
  const socials = (footerBlock?.props as { socials?: Array<{ url?: unknown }> } | undefined)?.socials ?? [];
  return {
    logoUrl: logoOf(header, "SiteHeader") ?? logoOf(footer, "SiteFooter"),
    sameAs: cleanSameAs(socials.map((s) => s.url)),
  };
}
