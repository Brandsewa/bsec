import type { z } from "zod";
import type { AgentCallKind, AgentSession, AiAction, AiResource, Runtime } from "@bs/domain";

/**
 * The protocol-neutral capability layer (ADR-050, layer L2). A capability is one thing an AI app may do for a store. It knows
 * nothing about MCP, JSON-RPC or HTTP: an adapter (packages/mcp today) turns this registry into its own tool format and calls
 * `runCapability`. A future adapter (REST, another assistant) reuses everything here unchanged.
 */
export interface CapabilityEnv {
  rt: Runtime;
  session: AgentSession;
}

export interface Capability<S extends z.ZodType = z.ZodType> {
  /** snake_case verb phrase, stable: it is the name the AI sees. */
  name: string;
  title: string;
  description: string;
  /** Matrix cell this capability needs; null means always allowed once AI access is on. */
  resource: AiResource | null;
  action: AiAction | null;
  /** Which usage limits apply: report calls and writes have their own. */
  kind: AgentCallKind;
  /** Makes something visible to shoppers: also needs the "Allow publishing" switch. */
  publishes?: boolean;
  /** A second store permission the approving user must hold (for example theme.publish to publish a page). */
  alsoNeeds?: { permission: string; text: string };
  /** The result contains text written by the store or its shoppers (names, notes, reviews): marked as data for the AI. */
  userText?: boolean;
  annotations: { readOnly: boolean; destructive: boolean; idempotent: boolean };
  input: S;
  handler: (env: CapabilityEnv, input: z.infer<S>) => Promise<unknown>;
}

export function defineCapability<S extends z.ZodType>(c: Capability<S>): Capability<S> {
  return c;
}

export type AnyCapability = Capability<z.ZodType>;

export type ToolErrorCode = "forbidden" | "invalid_input" | "not_found" | "conflict" | "rate_limited" | "unavailable" | "error";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

export type CapabilityResult = { ok: true; data: unknown; notice?: string } | { ok: false; error: ToolError };
