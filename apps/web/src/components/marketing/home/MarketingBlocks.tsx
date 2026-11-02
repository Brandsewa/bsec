import { renderBlockDocument, renderBlockTree } from "@bs/blocks";
import { CompanyBox } from "../landing/LegalBits.tsx";
import { SubdomainAvailabilityChecker } from "../SubdomainAvailabilityChecker.tsx";

/** A website page built in Super Admin. Null when its document cannot be drawn, so the caller keeps the built-in version (ADR-011). */
export function marketingPageContent(document: unknown) {
  const result = renderBlockDocument(document);
  if (!result.success || result.blocks.length === 0) return null;
  return renderBlockTree(result.blocks, {
    renderNameChecker: () => <SubdomainAvailabilityChecker platformDomain="bcom.si" />,
    renderCompany: () => <CompanyBox />,
  });
}
