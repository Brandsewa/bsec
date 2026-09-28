import routePending from "./route-pending.js";
import tenantCacheTag from "./tenant-cache-tag.js";

export const bsPlugin = {
  meta: { name: "eslint-plugin-bs", version: "0.0.0" },
  rules: { "tenant-cache-tag": tenantCacheTag, "route-pending": routePending },
};
export default bsPlugin;
