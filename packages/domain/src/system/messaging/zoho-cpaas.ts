import type {
  ChannelSendInput,
  ChannelSendResult,
  ChannelTestInput,
  ChannelTestResult,
  MessageChannel,
  MessageChannelAdapter,
} from "./types.ts";
import { cleanPhoneNumber, maskPhoneNumber } from "./masking.ts";

export interface ZohoCPaaSConfig {
  baseUrl?: string; // Default: https://cpaas.zoho.com/v1.1
  senderKey?: string; // For SMS: registered sender key in Zoho CPaaS Agent
  fromNumber?: string; // For WhatsApp: registered WABA sender phone number
  entityId?: string; // India TRAI DLT Principal Entity ID
  templateMap?: Record<string, string>; // Maps logical template name to Zoho template_key
}

export interface ZohoCPaaSOptions {
  channel: MessageChannel;
  token?: string | null;
  config: ZohoCPaaSConfig;
  fetchFn?: typeof fetch;
}

// In-memory rate limiting cache: Map<recipient, timestamp[]>
const recipientDispatches = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 5;

function checkRateLimit(recipient: string): boolean {
  const now = Date.now();
  const timestamps = (recipientDispatches.get(recipient) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (timestamps.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    return false;
  }
  timestamps.push(now);
  recipientDispatches.set(recipient, timestamps);
  return true;
}

/** Reset rate limit tracker (used for tests) */
export function _resetRateLimits(): void {
  recipientDispatches.clear();
}

/**
 * Sanitise errors returned from the provider so credentials, raw stack traces,
 * or sensitive connection strings never leak to UI or logs.
 */
export function sanitiseProviderError(raw: unknown): string {
  if (!raw) return "Unknown provider error";
  let msg = typeof raw === "string" ? raw : (raw as Error)?.message ?? JSON.stringify(raw);
  // Redact any tokens or Authorization headers
  msg = msg.replace(/Zoho-enczapikey\s+[A-Za-z0-9_-]+/gi, "Zoho-enczapikey [REDACTED]");
  msg = msg.replace(/Authorization:\s+[A-Za-z0-9_-]+/gi, "Authorization: [REDACTED]");
  // Limit message length
  return msg.slice(0, 300);
}

export class ZohoCPaaSAdapter implements MessageChannelAdapter {
  readonly channel: MessageChannel;
  readonly provider = "zoho_cpaas";
  private readonly token?: string | null;
  private readonly config: ZohoCPaaSConfig;
  private readonly fetch: typeof fetch;

  constructor(options: ZohoCPaaSOptions) {
    this.channel = options.channel;
    this.token = options.token?.trim() || null;
    this.config = options.config ?? {};
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const maskedRecipient = maskPhoneNumber(input.to);
    const cleanPhone = cleanPhoneNumber(input.to);

    // 1. Enrollment and credential check
    if (!this.token) {
      return {
        ok: false,
        maskedRecipient,
        error: "Provider is not enrolled: credentials missing",
      };
    }

    // 2. Per-recipient rate limiting
    if (!checkRateLimit(cleanPhone)) {
      return {
        ok: false,
        maskedRecipient,
        error: `Rate limit exceeded: maximum ${RATE_LIMIT_MAX_PER_WINDOW} dispatches per minute per recipient`,
      };
    }

    // 3. Resolve template key
    const templateKey =
      this.config.templateMap?.[input.template] ??
      (input.template === "test_message" ? "test_template" : input.template);

    const baseUrl = this.config.baseUrl?.replace(/\/+$/, "") || "https://cpaas.zoho.com/v1.1";

    try {
      if (this.channel === "sms") {
        const url = `${baseUrl}/sms`;
        const body = {
          sender_key: this.config.senderKey || "default_sender",
          template_key: templateKey,
          to: [{ mobile_no: cleanPhone }],
          merge_info: input.variables ?? {},
        };

        const res = await this.fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: this.token,
          },
          body: JSON.stringify(body),
        });

        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

        if (!res.ok) {
          const errDetail =
            (data?.error as { message?: string })?.message ||
            (data?.message as string) ||
            `HTTP ${res.status} ${res.statusText}`;
          return {
            ok: false,
            maskedRecipient,
            error: sanitiseProviderError(errDetail),
          };
        }

        const msgId = (Array.isArray(data?.data) && (data.data[0] as { message_id?: string })?.message_id) || null;
        return {
          ok: true,
          maskedRecipient,
          providerMessageId: msgId,
        };
      } else {
        // WhatsApp
        const url = `${baseUrl}/whatsapp`;
        const body = {
          from: this.config.fromNumber || "default_from",
          to: cleanPhone,
          template_key: templateKey,
          merge_info: input.variables ?? {},
        };

        const res = await this.fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: this.token,
          },
          body: JSON.stringify(body),
        });

        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

        if (!res.ok) {
          const errDetail =
            (data?.error as { message?: string })?.message ||
            (data?.message as string) ||
            `HTTP ${res.status} ${res.statusText}`;
          return {
            ok: false,
            maskedRecipient,
            error: sanitiseProviderError(errDetail),
          };
        }

        const msgId = (Array.isArray(data?.data) && (data.data[0] as { message_id?: string })?.message_id) || null;
        return {
          ok: true,
          maskedRecipient,
          providerMessageId: msgId,
        };
      }
    } catch (err) {
      return {
        ok: false,
        maskedRecipient,
        error: sanitiseProviderError(err),
      };
    }
  }

  async test(input: ChannelTestInput): Promise<ChannelTestResult> {
    const res = await this.send({
      to: input.to,
      template: "test_message",
      variables: { test_code: "123456" },
    });
    return {
      ok: res.ok,
      providerMessageId: res.providerMessageId,
      error: res.error,
    };
  }
}
