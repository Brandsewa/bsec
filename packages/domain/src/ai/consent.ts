/**
 * The acknowledgement a store owner accepts before AI access is switched on (docs/MCP-PLAN.md section 3.3, ADR-050 decision 5).
 * The version is stored with who accepted and when; changing the wording means bumping the version, which pauses AI calls
 * until the store accepts again. DRAFT wording: the owner's legal adviser must review it, and the company name must be filled
 * in, before launch (it is a launch blocker, see the plan).
 */
export const AI_CONSENT_VERSION = 1;

export const AI_CONSENT_TEXT: { title: string; intro: string; includes: string[]; notes: string[]; checkbox: string } = {
  title: "Turn on AI access?",
  intro:
    "AI access lets an AI assistant that you choose (for example Claude) read and change information in your store through a connection you approve. Depending on the permissions you set, this can include:",
  includes: [
    "Products, collections and prices",
    "Orders and order history",
    "Customer details: names, email addresses, phone numbers and addresses",
    "Sales, reports, and finance summaries (profit and loss, expenses)",
  ],
  notes: [
    "Information the AI reads is sent to the AI provider you connect (for example Anthropic) and is handled under that provider's own terms and privacy policy. Brand Sewa does not store what your AI reads.",
    "You decide what the AI may do in Permissions, and you can turn AI access off or disconnect any app at any time. Changes made by the AI are recorded in your activity log.",
    "AI assistants can make mistakes. You are responsible for reviewing what the AI does in your store.",
    "You are responsible for how customer and other data is shared with AI tools, including your privacy notice and your legal obligations to your customers (for example under the Digital Personal Data Protection Act, 2023).",
    "To the extent permitted by law, Brand Sewa is not liable for actions, decisions, losses or data handling by the AI provider or the AI assistant you connect.",
  ],
  checkbox: "I have read and agree",
};
