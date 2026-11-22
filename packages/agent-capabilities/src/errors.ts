import { ZodError } from "zod";
import { AgentAccessError, AgentRateLimitError } from "@bs/domain";
import type { ToolError } from "./types.ts";

/** Words that suggest a database or system message; those are never shown to the AI. */
const INTERNAL = /(select |insert |update |delete |violates|constraint|relation "|syntax error|econn|timeout|password|secret|stack|at \w+\.\w+ \()/i;

/** Raised by a capability itself for a refusal with a message the AI can relay. */
export class CapabilityError extends Error {
  readonly code: ToolError["code"];
  constructor(code: ToolError["code"], message: string) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
  }
}

/** A unique or foreign key violation from Postgres (drizzle wraps it, the code is on `cause`), said in the store owner's words. */
function databaseConflict(err: unknown): ToolError | null {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string; message?: string } } | null;
  const code = e?.cause?.code ?? e?.code;
  const constraint = String(e?.cause?.constraint ?? e?.constraint ?? "");
  if (code === "23505") {
    if (/slug/i.test(constraint)) return { code: "conflict", message: "That URL handle (slug) is already used. Choose a different slug." };
    if (/sku/i.test(constraint)) return { code: "conflict", message: "That SKU is already used by another variant. SKUs are unique across the store." };
    return { code: "conflict", message: "Something with the same unique value already exists. Change the value and try again." };
  }
  if (code === "23503") return { code: "invalid_input", message: "One of the ids you passed does not exist in this store (a category, collection, brand, tax class or image)." };
  return null;
}

/** Turns anything thrown below into a stable error with a plain message. Unknown failures say nothing about internals. */
export function toToolError(err: unknown): ToolError {
  if (err instanceof CapabilityError) return { code: err.code, message: err.message };
  if (err instanceof AgentRateLimitError) return { code: "rate_limited", message: err.message, retryAfterSeconds: err.retryAfter };
  if (err instanceof AgentAccessError) return { code: "forbidden", message: err.message };
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first?.path.length ? ` (${first.path.join(".")})` : "";
    return { code: "invalid_input", message: `${first?.message ?? "The input is not valid"}${where}` };
  }
  const db = databaseConflict(err);
  if (db) return db;
  if (err instanceof Error) {
    const m = err.message;
    const prefixed = /^(Forbidden|Not Found|Bad Request|Conflict|Unauthorized|Service Unavailable): (.*)$/s.exec(m);
    if (prefixed) {
      const kind = prefixed[1] ?? "";
      const text = prefixed[2] ?? m;
      const code: ToolError["code"] =
        kind === "Forbidden" || kind === "Unauthorized" ? "forbidden" : kind === "Not Found" ? "not_found" : kind === "Conflict" ? "conflict" : kind === "Service Unavailable" ? "unavailable" : "invalid_input";
      return { code, message: text.slice(0, 300) };
    }
    if (/not found/i.test(m) && m.length < 200 && !INTERNAL.test(m)) return { code: "not_found", message: m };
    if (m.length < 240 && !INTERNAL.test(m)) return { code: "invalid_input", message: m };
  }
  return { code: "error", message: "Something went wrong on our side. Try again in a moment." };
}
