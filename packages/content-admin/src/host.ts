import type { createORPCReactQueryUtils } from "@orpc/react-query";
import type { StoreClient } from "@bs/contracts";

/**
 * The blog, menu and media screens are shared by the store admin and Super Admin's Marketing section (ADR-042). Each
 * app runs one API, so it plugs that in once at startup, and the screens read these bindings instead of taking props.
 */
export type ContentClient = {
  admin: Pick<StoreClient["admin"], "blog" | "menus" | "media" | "pages" | "products" | "collections" | "categories" | "brands">;
};
export type ContentOrpc = ReturnType<typeof createORPCReactQueryUtils<ContentClient>>;

export interface ContentPaths {
  blog: string;
  blogNew: string;
  blogCategories: string;
  blogPost: (id: string) => string;
  menus: string;
  menu: (handle: string) => string;
  pageEditor: (id: string) => string;
}

export interface ContentHost {
  client: ContentClient;
  orpc: ContentOrpc;
  paths: ContentPaths;
  /** Where files go when the browser cannot upload straight to storage. */
  proxyUploadUrl: () => string;
  uploadHeaders: () => Record<string, string>;
  /** True when the host's own server check covers media writes, so the store role check does not apply. */
  contentWriteAllowed?: boolean;
  /** Link types with nothing to point at on this host (the website has no products). */
  hiddenMenuLinkTypes?: readonly string[];
  /** Line under the Pages heading. */
  pagesIntro: string;
}

export let client: ContentClient;
export let orpc: ContentOrpc;
export let paths: ContentPaths;
export let proxyUploadUrl: ContentHost["proxyUploadUrl"];
export let uploadHeaders: ContentHost["uploadHeaders"];
export let hiddenMenuLinkTypes: readonly string[] = [];
export let contentWriteAllowed = false;
export let pagesIntro = "";

export function configureContentHost(host: ContentHost): void {
  client = host.client;
  orpc = host.orpc;
  paths = host.paths;
  proxyUploadUrl = host.proxyUploadUrl;
  uploadHeaders = host.uploadHeaders;
  hiddenMenuLinkTypes = host.hiddenMenuLinkTypes ?? [];
  contentWriteAllowed = host.contentWriteAllowed ?? false;
  pagesIntro = host.pagesIntro;
}
