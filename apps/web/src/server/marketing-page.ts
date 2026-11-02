import { getPlatformSitePage, parsePageSeo } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/** A published website page, or null. A failed read also gives null, so a page with a built-in version keeps working (ADR-011). */
export async function marketingPage(path: string[]) {
  return getPlatformSitePage(server().rt, path).catch(() => null);
}

export function marketingPageMeta(page: NonNullable<Awaited<ReturnType<typeof marketingPage>>>["page"]) {
  const seo = parsePageSeo(page.seo);
  return { title: seo?.title || `${page.title} | BCOM`, description: seo?.description || undefined };
}
