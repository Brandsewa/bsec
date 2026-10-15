import { headers } from "next/headers";
import { buildBlogFeedXml, evaluateStorefrontAccess } from "@bs/domain";
import { server } from "@/server/runtime.ts";
import { getCachedBlogFeed, getCachedStoreName } from "@/server/cached-storefront.ts";

/** RSS 2.0 feed of the latest 20 posts (excerpts only). 404 when the blog is off or the host is unknown. */
export async function GET() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const access = await evaluateStorefrontAccess(server().rt, host, { headers: h });
  if (!access.tenantId || access.noindex) return new Response("Not found", { status: 404 });
  const [feed, storeName] = await Promise.all([getCachedBlogFeed(access.tenantId), getCachedStoreName(access.tenantId)]);
  if (!feed.enabled) return new Response("Not found", { status: 404 });
  return new Response(buildBlogFeedXml({ posts: feed.posts, settings: feed.settings, storeName, host }), {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" },
  });
}
