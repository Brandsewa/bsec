import { ORPCError } from "@orpc/client";

/** A short message that is safe to show a merchant. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ORPCError) {
    if (err.code === "FORBIDDEN") return "You do not have permission to do that.";
    if (err.code === "TOO_MANY_REQUESTS") return "Too many requests. Please wait a moment and try again.";
    // oRPC's own input check says only "Input validation failed"; the first issue says which field and why.
    const issues = (err.data as { issues?: Array<{ message?: string; path?: Array<string | number | { key: PropertyKey }> }> } | undefined)?.issues;
    const first = err.message === "Input validation failed" ? issues?.[0] : undefined;
    if (first?.message) {
      const where = (first.path ?? []).map((p) => (typeof p === "object" ? String(p.key) : String(p))).join(" > ");
      return where ? `${first.message} (${where})` : first.message;
    }
    // Server-side messages for expected failures (validation, conflicts, preconditions) are written for humans.
    if (err.code !== "INTERNAL_SERVER_ERROR" && err.message) return err.message;
  }
  return fallback;
}
