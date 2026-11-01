import type { BlockInstance } from "@bs/blocks";

/**
 * The launch theme ("Essential Commerce"): one conversion-focused, production-quality
 * template built only from registry blocks. Its JSON is also embedded in migration 0015; a
 * test keeps the two in sync so the platform never ships a theme that fails validation.
 */
export const LAUNCH_TEMPLATE_CODE = "essential-commerce";

export const LAUNCH_TEMPLATE_TOKENS = {
  colors: {
    primary: "#0b6b42",
    secondary: "#334155",
    accent: "#f59e0b",
    background: "#ffffff",
    surface: "#f4f7f5",
    text: "#16201b",
  },
  fonts: { heading: "Inter", body: "Inter" },
  radius: "md",
  buttons: { style: "solid", uppercase: false },
} as const;

const b = (id: string, type: BlockInstance["type"], props: Record<string, unknown>): BlockInstance => ({
  id,
  type,
  version: 1,
  props,
});

export const LAUNCH_TEMPLATE_HOME: BlockInstance[] = [
  b("ec-banner", "Banner", { text: "Free shipping on orders over ₹999", link: "/collections/all", variant: "promo", dismissible: false }),
  b("ec-hero", "HeroSlider", {
    slides: [
      {
        title: "Made with care. Delivered to your door.",
        subtitle: "Small-batch products from makers you can trust, with easy returns and fast shipping across India.",
        primaryLabel: "Shop the collection",
        primaryHref: "/collections/all",
        secondaryLabel: "Our story",
        secondaryHref: "/pages/about",
      },
    ],
  }),
  b("ec-usp", "TrustStrip", {
    items: [
      { icon: "truck", title: "Free shipping", description: "On orders above ₹999" },
      { icon: "shield", title: "Secure checkout", description: "UPI, cards and cash on delivery" },
      { icon: "returns", title: "Easy returns", description: "7-day return guarantee" },
      { icon: "headphones", title: "Friendly support", description: "Phone and WhatsApp" },
    ],
  }),
  b("ec-bestsellers", "ProductShowcase", {
    title: "Bestsellers",
    subtitle: "What our customers love most",
    tabs: [{ label: "Bestsellers", source: "featured", collectionSlug: "" }],
    limit: 8,
  }),
  b("ec-story", "Section", {
    content: [
      b("ec-story-box", "Container", {
        content: [
          b("ec-story-h", "Heading", { text: "Crafted with purpose", level: "h2", align: "left" }),
          b("ec-story-t", "Text", {
            text: "Every product is made in small batches by people who care about quality. We work directly with makers so you get honest pricing and real craftsmanship. Fresh batches, careful packaging and responsive support. Not happy? Return it within 7 days, no questions asked.",
            align: "left",
            muted: true,
          }),
          b("ec-story-b", "Button", { label: "Read our story", href: "/pages/about", variant: "outline", size: "md", fullWidth: false, align: "left" }),
        ],
      }),
    ],
  }),
  b("ec-testimonials", "ReviewsMarquee", { eyebrow: "Testimonials", title: "Loved by customers", description: "Real words from people who bought and tried our products.", tone: "surface" }),
  b("ec-new", "ProductShowcase", {
    title: "New arrivals",
    subtitle: "Just landed",
    tabs: [{ label: "New arrivals", source: "newest", collectionSlug: "" }],
    limit: 8,
  }),
  b("ec-faq", "FaqSection", {
    title: "Questions, answered",
    items: [
      { question: "How long does shipping take?", answer: "Orders usually arrive in 3-5 business days across India." },
      { question: "What is your return policy?", answer: "Return unused items within 7 days of delivery for a refund or exchange." },
      { question: "Do you offer cash on delivery?", answer: "Yes. Pay online with UPI or card, or choose cash on delivery at checkout." },
    ],
  }),
];

export const LAUNCH_TEMPLATE_HEADER: BlockInstance[] = [
  b("ec-header", "SiteHeader", {
    links: [
      { label: "Home", href: "/" },
      { label: "Shop", href: "/collections/all" },
      { label: "Our story", href: "/pages/about" },
    ],
    layout: "left",
    showSearch: true,
    showCart: true,
    sticky: true,
    tone: "default",
  }),
];

export const LAUNCH_TEMPLATE_FOOTER: BlockInstance[] = [
  b("ec-footer", "SiteFooter", {
    about: "Small-batch products from makers you can trust, delivered across India.",
    columns: [
      { title: "Shop", links: [{ label: "All products", href: "/collections/all" }, { label: "Search", href: "/search" }] },
      {
        title: "Policies",
        links: [
          { label: "Privacy Policy", href: "/policies/privacy" },
          { label: "Terms of Service", href: "/policies/terms" },
          { label: "Refund Policy", href: "/policies/refund" },
          { label: "Shipping Policy", href: "/policies/shipping" },
        ],
      },
    ],
    showNewsletter: true,
    newsletterTitle: "Newsletter",
    newsletterText: "Subscribe for updates and exclusive offers.",
    tone: "surface",
  }),
];

export const LAUNCH_TEMPLATE_PRODUCT: BlockInstance[] = [
  b("ec-product", "ProductDetail", { galleryPosition: "left", showBreadcrumb: true, showRating: true, showDescription: true, showTags: true }),
  b("ec-product-usp", "TrustStrip", {
    items: [
      { icon: "truck", title: "Free shipping", description: "On orders above ₹999" },
      { icon: "shield", title: "Secure checkout", description: "UPI, cards and cash on delivery" },
      { icon: "returns", title: "Easy returns", description: "7-day return guarantee" },
      { icon: "headphones", title: "Friendly support", description: "Phone and WhatsApp" },
    ],
  }),
  b("ec-product-more", "ProductShowcase", {
    title: "You may also like",
    tabs: [{ label: "Related", source: "related", collectionSlug: "" }],
    limit: 8,
  }),
];

export const LAUNCH_TEMPLATE_COLLECTION: BlockInstance[] = [
  b("ec-collection", "CollectionListing", { columns: "4", showFilters: true, showDescription: true }),
  b("ec-collection-cta", "Section", {
    content: [
      b("ec-collection-cta-box", "Container", {
        content: [
          b("ec-collection-cta-h", "Heading", { text: "Can't find what you need?", level: "h2", align: "center" }),
          b("ec-collection-cta-t", "Text", { text: "Message us and we'll help you choose.", align: "center", muted: true }),
          b("ec-collection-cta-b", "Button", { label: "Contact us", href: "/pages/contact", size: "md", fullWidth: false, align: "center" }),
        ],
      }),
    ],
  }),
];

/** Every page of the launch theme, keyed as theme_templates.default_pages stores them. */
export const LAUNCH_TEMPLATE_PAGES = {
  home: LAUNCH_TEMPLATE_HOME,
  collection: LAUNCH_TEMPLATE_COLLECTION,
  product: LAUNCH_TEMPLATE_PRODUCT,
  header: LAUNCH_TEMPLATE_HEADER,
  footer: LAUNCH_TEMPLATE_FOOTER,
};
