import type { PolicyContent } from "./validator.ts";

export type PolicyHandle = "refund" | "privacy" | "terms" | "shipping" | "legal_notice";

export const STARTER_NOTICE_TEXT =
  "Starter draft, not legal advice. Review with your own advisor before publishing.";

export interface PolicyStarter {
  handle: PolicyHandle;
  title: string;
  starter: true;
  content: PolicyContent;
}

export const POLICY_STARTERS: Record<PolicyHandle, PolicyStarter> = {
  refund: {
    handle: "refund",
    title: "Refund & Cancellation Policy",
    starter: true,
    content: {
      v: 1,
      blocks: [
        {
          type: "paragraph",
          text: `[${STARTER_NOTICE_TEXT}]`,
        },
        {
          type: "heading",
          level: 2,
          text: "Overview",
        },
        {
          type: "paragraph",
          text: "We want you to be completely satisfied with your purchase from [Store Name]. Please read our policy regarding returns, refunds, and cancellations below.",
        },
        {
          type: "heading",
          level: 2,
          text: "Cancellation Policy",
        },
        {
          type: "paragraph",
          text: "You may cancel an order before it has been dispatched by contacting our support team at [support@example.com] or via your customer account portal. Once dispatched, orders cannot be cancelled.",
        },
        {
          type: "heading",
          level: 2,
          text: "Returns & Exchanges",
        },
        {
          type: "list",
          style: "unordered",
          items: [
            "Return requests must be initiated within [7] days of delivery.",
            "Items must be unused, unwashed, and in original packaging with tags intact.",
            "Perishable goods, personalized items, and hygiene-sensitive items are non-returnable.",
          ],
        },
        {
          type: "heading",
          level: 2,
          text: "Refund Process",
        },
        {
          type: "paragraph",
          text: "Upon receipt and inspection of the returned product, refunds are initiated within [5-7] business days to the original payment method.",
        },
      ],
    },
  },
  privacy: {
    handle: "privacy",
    title: "Privacy Policy",
    starter: true,
    content: {
      v: 1,
      blocks: [
        {
          type: "paragraph",
          text: `[${STARTER_NOTICE_TEXT}]`,
        },
        {
          type: "heading",
          level: 2,
          text: "Introduction",
        },
        {
          type: "paragraph",
          text: "[Store Name] (operated by [Legal Business Name]) respects your privacy and is committed to protecting your personal data in accordance with applicable laws including India's Digital Personal Data Protection (DPDP) Act, 2023.",
        },
        {
          type: "heading",
          level: 2,
          text: "Information We Collect",
        },
        {
          type: "list",
          style: "unordered",
          items: [
            "Contact and delivery details (name, email address, phone number, shipping address).",
            "Order history and transactional data necessary to fulfil purchases and tax compliance.",
            "Communication records with our customer support team.",
          ],
        },
        {
          type: "heading",
          level: 2,
          text: "Cookies and Tracking",
        },
        {
          type: "paragraph",
          text: "Our website uses only strictly necessary cookies required for shopping bag persistence and secure customer authentication. We do not use third-party advertising or marketing trackers.",
        },
        {
          type: "heading",
          level: 2,
          text: "Your Data Rights & Grievance Officer",
        },
        {
          type: "paragraph",
          text: "You have the right to access, correct, or request erasure of your personal data. For privacy inquiries or grievances, contact our Grievance Officer at [privacy@example.com].",
        },
      ],
    },
  },
  terms: {
    handle: "terms",
    title: "Terms of Service",
    starter: true,
    content: {
      v: 1,
      blocks: [
        {
          type: "paragraph",
          text: `[${STARTER_NOTICE_TEXT}]`,
        },
        {
          type: "heading",
          level: 2,
          text: "Terms of Use",
        },
        {
          type: "paragraph",
          text: "Welcome to [Store Name]. By accessing or purchasing from our store, you agree to be bound by these Terms of Service.",
        },
        {
          type: "heading",
          level: 2,
          text: "Store Operations & Purchases",
        },
        {
          type: "paragraph",
          text: "All orders placed are subject to product availability and order confirmation. We reserve the right to refuse or cancel orders suspected of fraudulent activity.",
        },
        {
          type: "heading",
          level: 2,
          text: "Governing Law",
        },
        {
          type: "paragraph",
          text: "These terms and any separate agreements shall be governed by and construed in accordance with the laws of India, subject to the jurisdiction of courts in [City/State].",
        },
      ],
    },
  },
  shipping: {
    handle: "shipping",
    title: "Shipping Policy",
    starter: true,
    content: {
      v: 1,
      blocks: [
        {
          type: "paragraph",
          text: `[${STARTER_NOTICE_TEXT}]`,
        },
        {
          type: "heading",
          level: 2,
          text: "Order Processing & Dispatch",
        },
        {
          type: "paragraph",
          text: "Orders are processed within [1-2] business days. Orders placed on Sundays or public holidays will be dispatched the following working day.",
        },
        {
          type: "heading",
          level: 2,
          text: "Delivery Timelines & Charges",
        },
        {
          type: "list",
          style: "unordered",
          items: [
            "Standard shipping takes approximately [3-7] business days depending on location.",
            "Shipping charges are calculated at checkout based on destination and order weight.",
            "Tracking details are shared via email as soon as the consignment is handed over to the courier.",
          ],
        },
      ],
    },
  },
  legal_notice: {
    handle: "legal_notice",
    title: "Legal Notice",
    starter: true,
    content: {
      v: 1,
      blocks: [
        {
          type: "paragraph",
          text: `[${STARTER_NOTICE_TEXT}]`,
        },
        {
          type: "heading",
          level: 2,
          text: "Business Entity Information",
        },
        {
          type: "paragraph",
          text: "Entity Name: [Legal Entity Name]\nRegistered Address: [Complete Address, City, State, PIN]\nGSTIN: [GSTIN Number]\nContact Email: [contact@example.com]",
        },
      ],
    },
  },
};

/**
 * Checks whether content still contains starter placeholders (e.g., [Store Name], [support@example.com])
 * or the starter banner notice block.
 * Publishing is blocked if true.
 */
export function hasStarterPlaceholders(content: PolicyContent): { hasPlaceholders: boolean; reason?: string } {
  const placeholderRegex = /\[[A-Za-z0-9\s@.,/_#-]+\]/;

  for (const block of content.blocks) {
    if (block.type === "heading" || block.type === "paragraph") {
      if (block.text.includes(STARTER_NOTICE_TEXT)) {
        return {
          hasPlaceholders: true,
          reason: "Please remove the starter advice banner block before publishing.",
        };
      }
      const match = block.text.match(placeholderRegex);
      if (match) {
        return {
          hasPlaceholders: true,
          reason: `Unfilled template placeholder detected: "${match[0]}". Please fill in all placeholders before publishing.`,
        };
      }
    } else if (block.type === "list") {
      for (const item of block.items) {
        if (item.includes(STARTER_NOTICE_TEXT)) {
          return {
            hasPlaceholders: true,
            reason: "Please remove the starter advice banner before publishing.",
          };
        }
        const match = item.match(placeholderRegex);
        if (match) {
          return {
            hasPlaceholders: true,
            reason: `Unfilled template placeholder detected in list: "${match[0]}". Please fill in all placeholders before publishing.`,
          };
        }
      }
    }
  }

  return { hasPlaceholders: false };
}
