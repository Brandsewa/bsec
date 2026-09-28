import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { evaluateStorefrontAccess, generateBreadcrumbJsonLd } from "@bs/domain";
import { server } from "@/server/runtime.ts";

export const ALLOWED_POLICY_TYPES = ["privacy", "terms", "refund", "shipping"] as const;
export type PolicyType = (typeof ALLOWED_POLICY_TYPES)[number];

export function isValidPolicyType(type: string): type is PolicyType {
  return (ALLOWED_POLICY_TYPES as readonly string[]).includes(type);
}

export interface PolicyDefinition {
  title: string;
  lastUpdated: string;
  body: string;
}

export const policyContent: Record<PolicyType, PolicyDefinition> = {
  privacy: {
    title: "Privacy Policy",
    lastUpdated: "2026-09-01",
    body: `We are committed to protecting and respecting your personal privacy. This Privacy Policy sets out how our store collects, uses, protects, and discloses your personal data when you visit our website or make a purchase.

### Information We Collect
We collect personal information that you provide to us directly, such as your name, email address, postal address, phone number, and payment information when placing an order or registering an account.

### How We Use Your Information
- To fulfill and manage your orders, payments, returns, and exchanges.
- To communicate with you regarding your purchases, updates, and customer support queries.
- To prevent fraudulent transactions and monitor against security threats.
- To provide personalized recommendations and promotional communications, where permitted.

### Data Security & Retention
We use industry-standard security protocols and encryption to safeguard your data. Your data is retained only for as long as necessary to fulfill business and legal obligations.`,
  },
  terms: {
    title: "Terms of Service",
    lastUpdated: "2026-09-01",
    body: `Welcome to our store. By accessing or using our website, services, or purchasing products from us, you agree to be bound by these Terms of Service.

### Acceptance of Terms
Please read these terms carefully before using our platform. If you disagree with any part of these terms, you may not access the service or purchase products.

### Orders & Pricing
All product prices listed on our storefront are inclusive or exclusive of applicable taxes as indicated. We reserve the right to refuse or cancel any order for reasons including inventory inaccuracies or suspected fraudulent activity.

### Intellectual Property
All content on this site, including text, graphics, logos, images, and software, is the property of our store or its licensors and is protected by copyright and intellectual property laws.`,
  },
  refund: {
    title: "Refund & Return Policy",
    lastUpdated: "2026-09-01",
    body: `We take pride in our products and want you to be completely satisfied with your purchase.

### Returns Window
You may return unused, unopened items in their original packaging within 7 calendar days from the date of delivery.

### Return Process
1. Contact our support team with your order number and photos of the product if damaged or defective.
2. Our team will verify eligibility and generate a return shipping label or arrange pickup where available.
3. Once the returned item is inspected at our warehouse, your refund will be processed to the original payment method within 5–7 business days.

### Non-returnable Items
Custom-made products, consumable goods, and sale items marked as final sale cannot be returned.`,
  },
  shipping: {
    title: "Shipping & Delivery Policy",
    lastUpdated: "2026-09-01",
    body: `Here you will find details on shipping zones, rates, transit times, and tracking for orders placed through our store.

### Order Processing Time
All orders are processed within 1–2 business days. Orders placed over weekends or public holidays will be dispatched on the next business day.

### Shipping Rates & Estimates
- Standard Delivery (3–5 business days): Free on orders above ₹999. A flat shipping fee of ₹99 applies to orders under ₹999.
- Express Delivery (1–2 business days): Flat rate calculated at checkout depending on your pincode.

### Shipment Confirmation & Order Tracking
You will receive a shipment confirmation email and WhatsApp message containing your tracking number once your order has dispatched.`,
  },
};

interface PolicyPageProps {
  params: Promise<{ type: string }>;
}

export async function generateMetadata({ params }: PolicyPageProps): Promise<Metadata> {
  const { type } = await params;
  if (!isValidPolicyType(type)) {
    return { title: "Policy Not Found" };
  }

  const policy = policyContent[type];
  return {
    title: `${policy.title} | Store Policies`,
    description: `Read our ${policy.title.toLowerCase()} and customer commitments.`,
  };
}

export default async function PolicyPage({ params }: PolicyPageProps) {
  const { type } = await params;

  if (!isValidPolicyType(type)) {
    notFound();
  }

  const policy = policyContent[type];

  // Resolve tenant domain for breadcrumbs
  let host = "localhost";
  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    await evaluateStorefrontAccess(rt, host, { headers: h });
  } catch {
    // Non-fatal fallback
  }

  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: `https://${host}` },
    { name: "Policies", url: `https://${host}/policies/${type}` },
    { name: policy.title, url: `https://${host}/policies/${type}` },
  ]);

  return (
    <article className="mx-auto max-w-4xl px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
          {policy.title}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Last updated: {policy.lastUpdated}
        </p>
      </header>
      <div className="prose dark:prose-invert max-w-none whitespace-pre-line text-foreground/90 leading-relaxed">
        {policy.body}
      </div>
    </article>
  );
}
