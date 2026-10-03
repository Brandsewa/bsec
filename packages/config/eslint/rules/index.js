import noServiceCallInTx from "./no-service-call-in-tx.js";
import routePending from "./route-pending.js";
import tenantCacheTag from "./tenant-cache-tag.js";

export const bsPlugin = {
  meta: { name: "eslint-plugin-bs", version: "0.0.0" },
  rules: {
    "tenant-cache-tag": tenantCacheTag,
    "route-pending": routePending,
    "no-service-call-in-tx": noServiceCallInTx,
  },
};
export default bsPlugin;
