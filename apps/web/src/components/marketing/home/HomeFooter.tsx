import { renderBlockTree } from "@bs/blocks";
import { siteChrome } from "@/server/site-settings.ts";
import { platformLogoPair } from "@/server/brand-logo.ts";
import { BuiltInFooter } from "./BuiltInFooter.tsx";

export async function HomeFooter() {
  // A footer published under Storefront > Pages > Footer replaces the built-in one (ADR-011).
  const { footer } = await siteChrome().catch(() => ({ footer: null }));
  if (footer) return <>{renderBlockTree([{ id: "site-footer", type: "MkFooter", version: 1, props: { ...footer, brandLogo: await platformLogoPair() } }], {})}</>;
  return <BuiltInFooter />;
}
