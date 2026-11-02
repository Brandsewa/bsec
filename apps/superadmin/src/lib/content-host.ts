import { createORPCReactQueryUtils } from "@orpc/react-query";
import { configureContentHost, type ContentClient } from "@bs/content-admin/host.ts";
import { apiBase } from "./config.ts";
import { client } from "./orpc.ts";

/** The website has no catalogue, so the menu editor's product pickers read empty lists and those link types are hidden. */
const noCatalogue = {
  products: { list: () => Promise.resolve({ items: [], total: 0, page: 1, limit: 0 }) },
  collections: { list: () => Promise.resolve([]) },
  categories: { list: () => Promise.resolve([]) },
  brands: { list: () => Promise.resolve([]) },
};

const contentClient = {
  admin: { blog: client.marketing.blog, menus: client.marketing.menus, media: client.marketing.media, pages: client.marketing.pages, ...noCatalogue },
} as unknown as ContentClient;

configureContentHost({
  client: contentClient,
  orpc: createORPCReactQueryUtils(contentClient),
  paths: {
    blog: "/marketing/blog",
    blogNew: "/marketing/blog/new",
    blogCategories: "/marketing/blog/categories",
    blogPost: (id) => `/marketing/blog/${id}`,
    menus: "/marketing/navigation",
    menu: (handle) => `/marketing/navigation/${handle}`,
    pageEditor: (id) => `/marketing/pages/${id}/editor`,
  },
  proxyUploadUrl: () => `${apiBase()}/api/marketing/media/upload`,
  uploadHeaders: () => ({}),
  contentWriteAllowed: true,
  pagesIntro: "Pages of bcom.si, built from fixed website sections. A published About page replaces the built-in one; unpublish it to go back.",
  hiddenMenuLinkTypes: ["collection", "category", "brand", "product"],
});
