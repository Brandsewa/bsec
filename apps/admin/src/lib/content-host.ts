import { configureContentHost } from "@bs/content-admin/host.ts";
import { apiBase } from "./config.ts";
import { client, orpc } from "./orpc.ts";
import { getActiveStoreId } from "./session.ts";
import { getSupportStoreId, getSupportToken } from "./support.ts";

configureContentHost({
  client,
  orpc,
  paths: {
    blog: "/online-store/blog",
    blogNew: "/online-store/blog/new",
    blogCategories: "/online-store/blog/categories",
    blogPost: (id) => `/online-store/blog/${id}`,
    menus: "/online-store/menus",
    menu: (handle) => `/online-store/menus/${handle}`,
  },
  proxyUploadUrl: () => `${apiBase()}/api/admin/media/upload`,
  uploadHeaders: () => {
    const support = getSupportToken();
    if (support) {
      const storeId = getSupportStoreId();
      return { "x-support-token": support, ...(storeId ? { "x-store-id": storeId } : {}) };
    }
    const id = getActiveStoreId();
    return id ? { "x-store-id": id } : {};
  },
});
