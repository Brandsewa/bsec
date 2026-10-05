import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import {
  evaluateStorefrontAccess,
  generateBreadcrumbJsonLd,
  getPublishedPolicy,
  isFeatureEnabled,
  type PolicyBlock,
  type PolicyContent,
} from "@bs/domain";
import { server } from "@/server/runtime.ts";

export const ALLOWED_POLICY_TYPES = ["privacy", "terms", "refund", "shipping", "legal_notice"] as const;
export type PolicyType = (typeof ALLOWED_POLICY_TYPES)[number];

export function isValidPolicyType(type: string): type is PolicyType {
  return (ALLOWED_POLICY_TYPES as readonly string[]).includes(type);
}

export interface PolicyDefinition {
  title: string;
  lastUpdated: string;
  body: string;
}

export const fallbackPolicyContent: Record<string, PolicyDefinition> = {
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
You will receive a shipment confirmation email and tracking number once your order has dispatched.`,
  },
  legal_notice: {
    title: "Legal Notice",
    lastUpdated: "2026-09-01",
    body: `This storefront is an independent merchant store hosted on the bsec platform. For legal, registration, or business queries, please contact the merchant via their customer support email.`,
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

  const fallback = fallbackPolicyContent[type];
  return {
    title: `${fallback?.title ?? "Policy"} | Store Policies`,
    description: `Read our ${fallback?.title.toLowerCase() ?? "policy"} and customer commitments.`,
  };
}

function renderBlock(block: PolicyBlock, index: number) {
  if (block.type === "heading") {
    if (block.level === 3) {
      return (
        <h3 key={index} className="text-xl font-semibold mt-6 mb-3 text-foreground">
          {block.text}
        </h3>
      );
    }
    return (
      <h2 key={index} className="text-2xl font-bold mt-8 mb-4 text-foreground">
        {block.text}
      </h2>
    );
  }

  if (block.type === "paragraph") {
    return (
      <p key={index} className="my-4 text-foreground/90 leading-relaxed">
        {block.text}
      </p>
    );
  }

  if (block.type === "list") {
    if (block.style === "ordered") {
      return (
        <ol key={index} className="list-decimal pl-6 my-4 space-y-2 text-foreground/90">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    }
    return (
      <ul key={index} className="list-disc pl-6 my-4 space-y-2 text-foreground/90">
        {block.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }

  if (block.type === "divider") {
    return <hr key={index} className="my-8 border-border" />;
  }

  return null;
}

export default async function PolicyPage({ params }: PolicyPageProps) {
  const { type } = await params;

  if (!isValidPolicyType(type)) {
    notFound();
  }

  let host = "localhost";
  let tenantId: string | undefined;

  try {
    const h = await headers();
    host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
    const { rt } = server();
    const access = await evaluateStorefrontAccess(rt, host, { headers: h });
    tenantId = access.tenantId;
  } catch {
    // Non-fatal fallback
  }

  let publishedPolicy: { title: string; content: PolicyContent; version: number; publishedAt: string } | null = null;
  let policiesFlagOn = false;

  if (tenantId) {
    const { rt } = server();
    policiesFlagOn = await isFeatureEnabled(rt._db.db, tenantId, "settings.policies").catch(() => false);
    publishedPolicy = await getPublishedPolicy(rt._db.db, tenantId, type).catch(() => null);
  }

  // Fallback decision (ADR-011 / PLAN Slice 7B):
  // With flag ON: unpublished handle returns 404!
  // With flag OFF: show legacy boilerplate if nothing published.
  if (!publishedPolicy) {
    if (policiesFlagOn) {
      notFound();
    }
  }

  const fallback = fallbackPolicyContent[type] ?? {
    title: "Policy",
    lastUpdated: "2026-09-01",
    body: "",
  };

  const title = publishedPolicy?.title ?? fallback.title;
  const lastUpdated = publishedPolicy
    ? new Date(publishedPolicy.publishedAt).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : fallback.lastUpdated;

  const breadcrumbsJsonLd = generateBreadcrumbJsonLd([
    { name: "Home", url: `https://${host}` },
    { name: "Policies", url: `https://${host}/policies/${type}` },
    { name: title, url: `https://${host}/policies/${type}` },
  ]);

  return (
    <article className="mx-auto max-w-4xl px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJsonLd) }}
      />
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-muted">
          <span>Last updated: {lastUpdated}</span>
          {publishedPolicy && (
            <span className="rounded bg-muted/20 px-2 py-0.5 text-xs font-mono">
              Version {publishedPolicy.version}
            </span>
          )}
        </div>
      </header>
      {publishedPolicy ? (
        <div className="prose dark:prose-invert max-w-none text-foreground/90">
          {publishedPolicy.content.blocks.map((block, idx) => renderBlock(block, idx))}
        </div>
      ) : (
        <div className="prose dark:prose-invert max-w-none whitespace-pre-line text-foreground/90 leading-relaxed">
          {fallback.body}
        </div>
      )}
    </article>
  );
}
