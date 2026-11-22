import { enforceAgentLimits, noteDeniedCall, recordAgentCall, type AgentSession, type Runtime } from "@bs/domain";
import { analyticsCapabilities } from "./capabilities/analytics.ts";
import { collectionCapabilities } from "./capabilities/collections.ts";
import { customerCapabilities } from "./capabilities/customers.ts";
import { financeCapabilities } from "./capabilities/finance.ts";
import { orderCapabilities } from "./capabilities/orders.ts";
import { overviewCapabilities } from "./capabilities/overview.ts";
import { mediaCapabilities } from "./capabilities/product-media.ts";
import { variantCapabilities } from "./capabilities/product-variants.ts";
import { productCapabilities } from "./capabilities/products.ts";
import { toToolError } from "./errors.ts";
import { allowedCapabilities, refusalFor } from "./policy.ts";
import { STORE_TEXT_NOTICE, serialize } from "./shape.ts";
import type { AnyCapability, CapabilityResult } from "./types.ts";

/** Every capability the platform offers. Which of them a connection sees depends on the store's permission matrix. */
export const ALL_CAPABILITIES: readonly AnyCapability[] = [
  ...overviewCapabilities,
  ...productCapabilities,
  ...variantCapabilities,
  ...mediaCapabilities,
  ...collectionCapabilities,
  ...orderCapabilities,
  ...customerCapabilities,
  ...analyticsCapabilities,
  ...financeCapabilities,
] as unknown as AnyCapability[];

export function findCapability(name: string): AnyCapability | undefined {
  return ALL_CAPABILITIES.find((c) => c.name === name);
}

/** The capabilities this connection may use right now. Adapters expose only these in their tool list. */
export function capabilitiesFor(session: AgentSession): AnyCapability[] {
  return allowedCapabilities(session, ALL_CAPABILITIES);
}

/**
 * The single execution path every adapter uses: policy, input validation, usage limits, the handler, output shaping and the
 * call log. Returns a result or a stable error; it never throws.
 */
export async function runCapability(rt: Runtime, session: AgentSession, name: string, rawInput: unknown): Promise<CapabilityResult> {
  const started = Date.now();
  const db = rt._db.db;
  const cap = findCapability(name);
  if (!cap) return { ok: false, error: { code: "not_found", message: `There is no tool called ${name}.` } };

  const log = (status: "ok" | "denied" | "rate_limited" | "error", bytes = 0) => recordAgentCall(db, session, { tool: name, status, durationMs: Date.now() - started, bytes });

  const refusal = refusalFor(session, cap);
  if (refusal) {
    await log("denied");
    await noteDeniedCall(db, session);
    return { ok: false, error: { code: "forbidden", message: refusal } };
  }

  const parsed = cap.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    await log("error");
    return { ok: false, error: toToolError(parsed.error) };
  }

  try {
    await enforceAgentLimits(db, session, cap.kind);
  } catch (err) {
    const error = toToolError(err);
    await log(error.code === "rate_limited" ? "rate_limited" : "error");
    return { ok: false, error };
  }

  try {
    const data = await cap.handler({ rt, session }, parsed.data);
    const out = serialize(data);
    await log("ok", out.text.length);
    return { ok: true, data: JSON.parse(out.text) as unknown, ...(cap.userText ? { notice: STORE_TEXT_NOTICE } : {}) };
  } catch (err) {
    const error = toToolError(err);
    await log("error");
    return { ok: false, error };
  }
}
