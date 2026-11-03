import type { ReactNode } from "react";
import { RichBlocks } from "@/components/storefront/RichBlocks.tsx";
import { sitePolicy } from "@/server/site-settings.ts";
import { RelatedLinks } from "./LegalBits.tsx";
import { DocBody, DocHeader, PageFrame } from "./PageFrame.tsx";

/**
 * A policy published in Super Admin > Storefront > Settings > Policies, in the legal page frame. Null while none is
 * published, so the page keeps its built-in text (ADR-011): the payment reviewers' wording only changes on purpose.
 */
export async function publishedPolicy(handle: "terms" | "privacy" | "refund" | "shipping" | "legal_notice"): Promise<ReactNode | null> {
  const policy = await sitePolicy(handle);
  if (!policy) return null;
  const updated = new Date(policy.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  return (
    <PageFrame>
      <DocHeader eyebrow="Legal" title={policy.title} />
      <DocBody>
        <p className="meta">Last updated {updated}</p>
        <RichBlocks blocks={policy.content.blocks} />
        <RelatedLinks />
      </DocBody>
    </PageFrame>
  );
}
