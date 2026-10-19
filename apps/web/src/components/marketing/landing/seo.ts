import { SITE } from "./site-info.ts";

/** schema.org Organization for the marketing site: the same legal details the footer and contact page show. */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.product,
    legalName: SITE.legalName,
    url: SITE.url,
    parentOrganization: { "@type": "Organization", name: SITE.parentName, url: SITE.parentUrl },
    address: {
      "@type": "PostalAddress",
      streetAddress: SITE.address.street,
      addressLocality: SITE.address.city,
      addressRegion: SITE.address.state,
      postalCode: SITE.address.postalCode,
      addressCountry: "IN",
    },
    email: SITE.emails.general,
    contactPoint: [
      { "@type": "ContactPoint", contactType: "customer support", email: SITE.emails.support, areaServed: "IN", availableLanguage: ["en"] },
    ],
  };
}
