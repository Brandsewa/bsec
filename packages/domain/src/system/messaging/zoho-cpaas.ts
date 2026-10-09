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
  entityId?: string; // India TRAI DLT Principal Entity ID (stored compliance note)
  templateMap?: Record<string, string>; // Maps logical template name to Zoho template_key
  testTemplateKey?: string; // Explicit template key required for diagnostic test dispatches
}

export interface ZohoCPaaSOptions {
  channel: MessageChannel;
  token?: string | null;
  config: ZohoCPaaSConfig;
  fetchFn?: typeof fetch;
}

// In-memory rate limiting cache: Map<recipient, timestamp[]>
// Note: In-memory tracker operates per Node.js worker process.
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
 * Also redacts the configured token value directly.
 */
export function sanitiseProviderError(raw: unknown, tokenToRedact?: string | null): string {
  if (!raw) return "Unknown provider error";
  let msg = typeof raw === "string" ? raw : (raw as Error)?.message ?? JSON.stringify(raw);
  // Redact any tokens or Authorization headers
  msg = msg.replace(/Zoho-enczapikey\s+[A-Za-z0-9_-]+/gi, "Zoho-enczapikey [REDACTED]");
  msg = msg.replace(/Authorization:\s+[A-Za-z0-9_-]+/gi, "Authorization: [REDACTED]");
  if (tokenToRedact && tokenToRedact.trim().length > 0) {
    msg = msg.split(tokenToRedact.trim()).join("[REDACTED]");
  }
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

    // 2. Validate channel-specific required configuration (no invented fallbacks)
    if (this.channel === "sms" && !this.config.senderKey?.trim()) {
      return {
        ok: false,
        maskedRecipient,
        error: "Provider configuration error: sender key is not configured",
      };
    }

    if (this.channel === "whatsapp" && !this.config.fromNumber?.trim()) {
      return {
        ok: false,
        maskedRecipient,
        error: "Provider configuration error: from phone number is not configured",
      };
    }

    // 3. Resolve template key (no invented fallbacks like 'test_template')
    const templateKey =
      input.template === "test_message"
        ? (this.config.templateMap?.["test_message"] ?? this.config.testTemplateKey)
        : this.config.templateMap?.[input.template];

    if (!templateKey || !templateKey.trim()) {
      return {
        ok: false,
        maskedRecipient,
        error: `Provider configuration error: template key for "${input.template}" is not configured`,
      };
    }

    // 4. Per-recipient rate limiting
    if (!checkRateLimit(cleanPhone)) {
      return {
        ok: false,
        maskedRecipient,
        error: `Rate limit exceeded: maximum ${RATE_LIMIT_MAX_PER_WINDOW} dispatches per minute per recipient`,
      };
    }

    const baseUrl = this.config.baseUrl?.replace(/\/+$/, "") || "https://cpaas.zoho.com/v1.1";

    try {
      if (this.channel === "sms") {
        // CONFIRMED via Zoho CPaaS SMS API documentation:
        // POST https://cpaas.zoho.com/v1.1/sms with Authorization holding the raw token (no "Bearer").
        // Request payload fields: sender_key, template_key, to: [{ mobile_no }], merge_info.
        const url = `${baseUrl}/sms`;
        const body = {
          sender_key: (this.config.senderKey ?? "").trim(),
          template_key: templateKey.trim(),
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
          // UNCONFIRMED: Exact error JSON schema returned by Zoho CPaaS on non-2xx status.
          const errDetail =
            (data?.error as { message?: string })?.message ||
            (typeof data?.error === "string" ? data.error : null) ||
            (data?.message as string) ||
            `HTTP ${res.status} ${res.statusText}`;
          return {
            ok: false,
            maskedRecipient,
            error: sanitiseProviderError(errDetail, this.token),
          };
        }

        // UNCONFIRMED: Exact success response body schema is not published in Zoho CPaaS docs.
        // We attempt to extract a message_id if present (e.g. data[0].message_id, message_id, id),
        // but treat any unknown 2xx body as success without an ID rather than failing.
        let msgId: string | null = null;
        if (Array.isArray(data?.data) && data.data[0] && typeof (data.data[0] as Record<string, unknown>).message_id === "string") {
          msgId = (data.data[0] as Record<string, unknown>).message_id as string;
        } else if (typeof data?.message_id === "string") {
          msgId = data.message_id;
        } else if (typeof data?.id === "string") {
          msgId = data.id;
        }

        return {
          ok: true,
          maskedRecipient,
          providerMessageId: msgId,
        };
      } else {
        // WhatsApp
        // CONFIRMED via Zoho CPaaS WhatsApp API documentation:
        // POST https://cpaas.zoho.com/v1.1/whatsapp with raw Authorization token.
        // Body fields: from, to, template_key, merge_info.
        // UNCONFIRMED: Language specification field (e.g. language: { code: "en" }) is not documented.
        const url = `${baseUrl}/whatsapp`;
        const body = {
          from: (this.config.fromNumber ?? "").trim(),
          to: cleanPhone,
          template_key: templateKey.trim(),
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
          // UNCONFIRMED: Error format on non-2xx WhatsApp dispatches.
          const errDetail =
            (data?.error as { message?: string })?.message ||
            (typeof data?.error === "string" ? data.error : null) ||
            (data?.message as string) ||
            `HTTP ${res.status} ${res.statusText}`;
          return {
            ok: false,
            maskedRecipient,
            error: sanitiseProviderError(errDetail, this.token),
          };
        }

        // UNCONFIRMED: Success response body schema for WhatsApp.
        // Treat any 2xx response as success even if message identifier is not present.
        let msgId: string | null = null;
        if (Array.isArray(data?.data) && data.data[0] && typeof (data.data[0] as Record<string, unknown>).message_id === "string") {
          msgId = (data.data[0] as Record<string, unknown>).message_id as string;
        } else if (typeof data?.message_id === "string") {
          msgId = data.message_id;
        } else if (typeof data?.id === "string") {
          msgId = data.id;
        }

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
        error: sanitiseProviderError(err, this.token),
      };
    }
  }

  async test(input: ChannelTestInput): Promise<ChannelTestResult> {
    const testTemplateKey =
      this.config.templateMap?.["test_message"] ??
      this.config.testTemplateKey;

    if (!testTemplateKey?.trim()) {
      return {
        ok: false,
        error: "Provider configuration error: test template key is not configured (map test_message in templateMap or configure testTemplateKey)",
      };
    }

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
