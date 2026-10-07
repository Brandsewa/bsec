import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import noServiceCallInTx from "../eslint/rules/no-service-call-in-tx.js";
import routePending from "../eslint/rules/route-pending.js";
import tenantCacheTag from "../eslint/rules/tenant-cache-tag.js";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

tester.run("no-service-call-in-tx", noServiceCallInTx, {
  valid: [
    "await withTenant(db, tenantId, async (tx) => { await doInternal(tx, data); })",
    "await db.transaction(async (tx) => { await insertRow(tx); })",
    "await withTenant(db, tenantId, async (tx) => { await doWork({ _db: { db: tx } } as unknown as Runtime); })",
    "const res = await withTenant(db, tenantId, async (tx) => { return 1; }); await invalidateCache(tags);",
    "await getProduct(rt, ctx, id);",
    "await withTenant(db, tenantId, async (tx) => { await setMarketingConsent(rt, ctx, input, tx); })",
  ],
  invalid: [
    {
      code: "await withTenant(db, tenantId, async (tx) => { await getProduct(rt, ctx, id); })",
      errors: [{ messageId: "noTxServiceCall" }],
    },
    {
      code: "await db.transaction(async (tx) => { await invalidateCache(['tag']); })",
      errors: [{ messageId: "noTxServiceCall" }],
    },
    {
      code: "await withTenant(db, tenantId, async (tx) => { await revalidateTags(['tag']); })",
      errors: [{ messageId: "noTxServiceCall" }],
    },
    {
      code: "await withTenant(db, tenantId, async (tx) => { await doSomething(rt as any); })",
      errors: [{ messageId: "noTxServiceCall" }],
    },
  ],
});

tester.run("tenant-cache-tag", tenantCacheTag, {
  valid: [
    "cacheTag(tenantTag(ctx, 'product', id))",
    "cacheTag(`t:${ctx.tenantId}:theme`)",
    "cacheTag(`t:${t}:product:${id}`, tenantTag(ctx, 'nav'))",
    "revalidateTag(`t:${t}:nav`, 'max')",
    "updateTag(tenantTag(ctx, 'seo'))",
  ],
  invalid: [
    { code: "cacheTag('products')", errors: [{ messageId: "notTenant" }] },
    { code: "cacheTag(`product:${id}`)", errors: [{ messageId: "notTenant" }] },
    { code: "cacheTag(`t:${t}theme`)", errors: [{ messageId: "notTenant" }] },
    { code: "cacheTag(tag)", errors: [{ messageId: "notTenant" }] },
    { code: "revalidateTag('nav', 'max')", errors: [{ messageId: "notTenant" }] },
    { code: "cache.updateTag(`x:${t}:y`)", errors: [{ messageId: "notTenant" }] },
  ],
});

import designSystemGuards from "../eslint/rules/design-system-guards.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bs-rules-"));
const withLoading = path.join(tmp, "app", "a");
const withoutLoading = path.join(tmp, "app", "b");
fs.mkdirSync(withLoading, { recursive: true });
fs.mkdirSync(withoutLoading, { recursive: true });
fs.writeFileSync(path.join(withLoading, "loading.tsx"), "");

tester.run("route-pending", routePending, {
  valid: [
    {
      filename: "/x/src/routes/orders.tsx",
      code: "export const Route = createFileRoute('/orders')({ pendingComponent: S })",
    },
    { filename: "/x/src/routes/-components/table.tsx", code: "export const x = 1" },
    { filename: "/x/src/lib/util.tsx", code: "export const x = 1" },
    { filename: path.join(withLoading, "page.tsx"), code: "export default function P() {}", options: [{ mode: "next" }] },
  ],
  invalid: [
    {
      filename: "/x/src/routes/orders.tsx",
      code: "export const Route = createFileRoute('/orders')({})",
      errors: [{ messageId: "missingPending" }],
    },
    {
      filename: path.join(withoutLoading, "page.tsx"),
      code: "export default function P() {}",
      options: [{ mode: "next" }],
      errors: [{ messageId: "missingLoading" }],
    },
  ],
});

tester.run("design-system-guards", designSystemGuards, {
  valid: [
    // storefront files keep their own look and are not guarded
    { filename: "C:/dev/bsec/apps/web/src/components/catalog/Filter.tsx", code: "const a = <select />;" },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: 'import { Button } from "@bs/ui"; const el = <Button className="rounded-md">Click</Button>;',
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: '<Select><SelectItem value="1">One</SelectItem></Select>;',
    },
    {
      filename: "C:/dev/bsec-design-system/packages/ui/src/button.tsx",
      code: 'import { Dialog } from "@base-ui/react";',
    },
  ],
  invalid: [
    { filename: "C:/dev/bsec/apps/web/src/components/account/Form.tsx", code: "const a = <select />;", errors: [{ messageId: "noNativeSelect" }] },
    { filename: "C:/dev/bsec/apps/web/src/components/orders/Return.tsx", code: 'window.confirm("sure?");', errors: [{ messageId: "noWindowConfirm" }] },
    { filename: "C:/dev/bsec/apps/web/src/app/account/page.tsx", code: 'const c = "#ff0000";', errors: [{ messageId: "noRawHex" }] },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/components/ui/button.tsx",
      code: "export const x = 1;",
      errors: [{ messageId: "noLocalUi" }],
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: 'import { Dialog } from "@base-ui/react";',
      errors: [{ messageId: "noRestrictedImports" }],
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: 'import { toast } from "sonner";',
      errors: [{ messageId: "noRestrictedImports" }],
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: 'import { Command } from "cmdk";',
      errors: [{ messageId: "noRestrictedImports" }],
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: 'import { Drawer } from "vaul";',
      errors: [{ messageId: "noRestrictedImports" }],
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: "<select><option>One</option></select>;",
      errors: [{ messageId: "noNativeSelect" }],
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: 'window.confirm("Delete tenant?");',
      errors: [{ messageId: "noWindowConfirm" }],
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: '<Button className="rounded-full">Pill</Button>;',
      errors: [{ messageId: "noRoundedFullButton" }],
    },
    {
      filename: "C:/dev/bsec-design-system/apps/admin/src/routes/orders.tsx",
      code: 'const hex = "#00d4a4";',
      errors: [{ messageId: "noRawHex" }],
    },
  ],
});
