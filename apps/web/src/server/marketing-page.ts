import { connection } from "next/server";
import { getPlatformSitePage, parsePageSeo } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/**
 * A published website page, or null. A failed read also gives null, so a page with a built-in version keeps working
 * (ADR-011). Waits for a request first: at build time there is no database, and a page built then would never change.
 */
export async function marketingPage(path: string[]) {
  await connection();
  try {
    return await getPlatformSitePage(server().rt, path);
  } catch {
    return null;
  }
}

export function marketingPageMeta(page: NonNullable<Awaited<ReturnType<typeof marketingPage>>>["page"]) {
  const seo = parsePageSeo(page.seo);
  return { title: seo?.title || `${page.title} | BCOM`, description: seo?.description || undefined };
}
