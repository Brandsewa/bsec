import type { Db } from "@bs/db";

/**
 * SMS and WhatsApp adapter (docs/NOTIFICATION-MANAGER-PLAN.md, owner decision 2026-10-27: build now, switch on later).
 * The contract is final; the Zoho CPaaS implementation is not connected until the owner has credentials and DLT-approved
 * template ids. Until then every send returns `disabled` and nothing leaves the platform. No live provider keys are added
 * (AGENTS.md rule 14 spirit: provider credentials are the owner's call).
 */

export interface SmsMessage {
  eventKey: string;
  tenantId: string | null;
  /** E.164 phone numbers. */
  to: string[];
  /** Values for the approved template's placeholders. */
  variables: Record<string, string>;
}

export interface SmsResult {
  status: "sent" | "disabled" | "no_template" | "failed";
  error?: string | undefined;
}

export interface SmsAdapter {
  readonly channel: "sms" | "whatsapp";
  send(message: SmsMessage): Promise<SmsResult>;
}

/** Placeholder adapter used until the provider is connected. */
export const disabledSmsAdapter: SmsAdapter = {
  channel: "sms",
  async send() {
    return { status: "disabled" };
  },
};

/** Returns the live adapter once a provider is configured; today always the disabled one. */
export async function loadSmsAdapter(_db: Db): Promise<SmsAdapter> {
  return disabledSmsAdapter;
}
