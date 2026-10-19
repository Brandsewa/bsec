/**
 * Who runs the site. One source for the footer, the contact page, the legal pages and the Organization JSON-LD, so
 * every page states the same details (payment-gateway reviewers compare them). Supplied by the owner 2026-10-19.
 * No phone number is published yet (owner decision); add `phone` here when there is one.
 */
export const SITE = {
  /** Name on the page. */
  product: "BCOM",
  domain: "bcom.si",
  url: "https://bcom.si",
  legalName: "Brand Sewa Digital Private Limited",
  parentName: "Brand Sewa",
  parentUrl: "https://brandsewa.com",
  address: {
    street: "Hill Cart Road",
    city: "Darjeeling",
    state: "West Bengal",
    postalCode: "734101",
    country: "India",
  },
  cin: "U74999WB2021PTC248925",
  gstin: "19AAKCB2303E1Z2",
  emails: {
    general: "info@bcom.si",
    support: "support@bcom.si",
  },
  grievance: {
    name: "Veeplov Rai",
    title: "Grievance Officer",
    email: "legalteam@brandsewa.com",
    acknowledgeHours: 48,
    resolveDays: 30,
  },
  /** Courts for disputes (terms of service). */
  jurisdiction: "West Bengal, India",
  /** Shown on every legal page; bump when the text changes. */
  legalUpdated: "19 October 2026",
} as const;

export const ADDRESS_LINE = `${SITE.address.street}, ${SITE.address.city}, ${SITE.address.state} ${SITE.address.postalCode}, ${SITE.address.country}`;

/** Public pages on the marketing host (sitemap, nav, footer and the middleware allow-list read this). */
export const MARKETING_PAGES = [
  { path: "/about", label: "About us" },
  { path: "/contact", label: "Contact us" },
  { path: "/pricing", label: "Pricing" },
  { path: "/terms", label: "Terms of service" },
  { path: "/privacy", label: "Privacy policy" },
  { path: "/refund-policy", label: "Refund and cancellation policy" },
  { path: "/shipping-policy", label: "Delivery policy" },
] as const;
