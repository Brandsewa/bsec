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
    accent: "#f59e0b",
    background: "#ffffff",
    surface: "#f4f7f5",
    text: "#16201b",
  },
  typography: { headingFont: "Inter", bodyFont: "Inter", scale: 1.0 },
  shape: { radius: "0.5rem", buttonStyle: "rounded" },
} as const;

const b = (id: string, type: BlockInstance["type"], props: Record<string, unknown>): BlockInstance => ({
  id,
  type,
  version: 1,
  props,
});

export const LAUNCH_TEMPLATE_HOME: BlockInstance[] = [
  b("ec-banner", "Banner", { text: "Free shipping on orders over ₹999", link: "/collections/all", variant: "promo", dismissible: false }),
  b("ec-hero", "Hero", {
    eyebrow: "New season",
    title: "Made with care. Delivered to your door.",
    subtitle: "Small-batch products from makers you can trust, with easy returns and fast shipping across India.",
    ctaText: "Shop the collection",
    ctaLink: "/collections/all",
    secondaryCtaText: "Our story",
    secondaryCtaLink: "/pages/about",
    alignment: "left",
    overlayOpacity: 30,
    tone: "primary",
  }),
  b("ec-usp", "UspStrip", {
    items: [
      { icon: "Truck", title: "Free shipping", description: "On orders above ₹999" },
      { icon: "ShieldCheck", title: "Secure checkout", description: "UPI, cards and cash on delivery" },
      { icon: "RotateCcw", title: "Easy returns", description: "7-day return guarantee" },
      { icon: "Headphones", title: "Friendly support", description: "Phone and WhatsApp" },
    ],
  }),
  b("ec-bestsellers", "ProductCarousel", {
    title: "Bestsellers",
    subtitle: "What our customers love most",
    source: "featured",
    limit: 8,
    columns: "4",
    showPrice: true,
    showRating: true,
    viewAllLabel: "View all",
    viewAllHref: "/collections/all",
    tone: "default",
  }),
  b("ec-story", "Section", {
    tone: "surface",
    paddingY: "lg",
    width: "wide",
    content: [
      b("ec-story-grid", "Grid", {
        columns: 2,
        columnsMobile: 1,
        gap: "lg",
        content: [
          b("ec-story-left", "FlexColumn", {
            gap: "md",
            alignItems: "start",
            content: [
              b("ec-story-h", "Heading", { text: "Crafted with purpose", level: "h2", size: "lg", align: "left" }),
              b("ec-story-t", "Text", {
                text: "Every product is made in small batches by people who care about quality. We work directly with makers so you get honest pricing and real craftsmanship.",
                align: "left",
                muted: true,
              }),
              b("ec-story-b", "Button", { label: "Read our story", href: "/pages/about", variant: "outline", size: "md", fullWidth: false, align: "left" }),
            ],
          }),
          b("ec-story-right", "FlexColumn", {
            gap: "md",
            alignItems: "start",
            content: [
              b("ec-why-h", "Heading", { text: "Why customers come back", level: "h2", size: "lg", align: "left" }),
              b("ec-why-t", "Text", {
                text: "Fresh batches, careful packaging and responsive support.\n\nNot happy? Return it within 7 days, no questions asked.",
                align: "left",
                muted: true,
              }),
            ],
          }),
        ],
      }),
    ],
  }),
  b("ec-cta", "CallToAction", {
    heading: "Ready to find your favourites?",
    text: "Browse the full collection and get free shipping on orders over ₹999.",
    primaryLabel: "Shop now",
    primaryHref: "/collections/all",
    overlayOpacity: 45,
    tone: "primary",
    align: "center",
  }),
  b("ec-testimonials", "Testimonials", {
    title: "Loved by customers",
    layout: "grid",
    tone: "surface",
    items: [
      { quote: "Beautiful quality and it arrived in two days. Already ordered again.", author: "Aarav S.", role: "Verified buyer", rating: 5 },
      { quote: "Exactly as described and the packaging was lovely. Great support too.", author: "Meera K.", role: "Verified buyer", rating: 5 },
      { quote: "Fair prices for the quality. Easy returns made me confident to try.", author: "Rohan P.", role: "Verified buyer", rating: 4 },
    ],
  }),
  b("ec-new", "ProductGrid", {
    title: "New arrivals",
    subtitle: "Just landed",
    source: "newest",
    limit: 8,
    columns: "4",
    showPrice: true,
    showRating: true,
    tone: "default",
  }),
  b("ec-faq", "FAQ", {
    title: "Questions, answered",
    items: [
      { question: "How long does shipping take?", answer: "Orders usually arrive in 3-5 business days across India." },
      { question: "What is your return policy?", answer: "Return unused items within 7 days of delivery for a refund or exchange." },
      { question: "Do you offer cash on delivery?", answer: "Yes. Pay online with UPI or card, or choose cash on delivery at checkout." },
    ],
  }),
];
