import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "@/components/storefront/IntentLink.tsx";
import { STORE_POLICY_LINK_OPTIONS } from "@bs/contracts";
import {
  evaluateStorefrontAccess,
  formatTitle,
  getPublishedPolicy,
  getStorefrontSeoSettings,
  getStoreSettings,
  isFeatureEnabled,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";

export async function generateMetadata(): Promise<Metadata> {
  const fallback: Metadata = {
    title: "Store Policies",
    description: "Read our store policies, terms, privacy, refund, and shipping commitments.",
  };

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    if (!access.tenantId) return fallback;
    const ctx = {
      tenantId: access.tenantId,
      storeStatus: access.mode ?? "live",
      actor: { type: "system" as const },
      roles: ["store_admin"],
      permissions: ["settings.write"],
      requestId: crypto.randomUUID(),
    };
    const [seoSettings, storeSettings] = await Promise.all([
      getStorefrontSeoSettings(rt, ctx).catch(() => null),
      getStoreSettings(rt, ctx).catch(() => null),
    ]);
    const storeName = storeSettings?.storeName ?? "Store";
    return {
      title: formatTitle(seoSettings?.titleTemplate, "Policies", storeName),
      description: `Store policies for ${storeName}: privacy, terms, refunds, and shipping.`,
      alternates: { canonical: `https://${host}/policies` },
    };
  } catch {
    return fallback;
  }
}

export default async function PoliciesIndexPage() {
  let tenantId: string | undefined;
  let policiesFlagOn = false;

  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    tenantId = access.tenantId;
    if (tenantId) {
      policiesFlagOn = await isFeatureEnabled(rt._db.db, tenantId, "settings.policies").catch(() => false);
    }
  } catch {
    // Non-fatal fallback
  }

  const publishedMap = new Map<string, string>();
  if (tenantId) {
    const resolvedTenantId = tenantId;
    const { rt } = server();
    const entries = await Promise.all(
      STORE_POLICY_LINK_OPTIONS.map(async (opt) => {
        const pub = await getPublishedPolicy(rt._db.db, resolvedTenantId, opt.handle).catch(() => null);
        return pub ? ([opt.handle, pub.title] as const) : null;
      }),
    );
    for (const entry of entries) {
      if (entry) publishedMap.set(entry[0], entry[1]);
    }
  }

  const visiblePolicies = STORE_POLICY_LINK_OPTIONS.filter(
    (opt) => !policiesFlagOn || publishedMap.has(opt.handle),
  ).map((opt) => ({
    handle: opt.handle,
    title: publishedMap.get(opt.handle) ?? opt.label,
    path: opt.path,
  }));

  return (
    <section className="bs-skin mx-auto max-w-4xl px-4 py-12">
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
          Store Policies
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review our terms, privacy practices, shipping guidelines, and refund policies.
        </p>
      </header>

      {visiblePolicies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No policies have been published yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {visiblePolicies.map((policy) => (
            <li key={policy.handle}>
              <Link
                href={policy.path}
                className="flex items-center justify-between px-5 py-4 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
              >
                <span>{policy.title}</span>
                <span aria-hidden="true" className="text-muted-foreground">&rarr;</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
