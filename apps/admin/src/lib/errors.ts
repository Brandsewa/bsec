import { ORPCError } from "@orpc/client";

/** A short message that is safe to show a merchant. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ORPCError) {
    if (err.code === "FORBIDDEN") return "You do not have permission to do that.";
    if (err.code === "TOO_MANY_REQUESTS") return "Too many requests. Please wait a moment and try again.";
    // Server-side messages for expected failures (validation, conflicts, preconditions) are written for humans.
    if (err.code !== "INTERNAL_SERVER_ERROR" && err.message) return err.message;
  }
  return fallback;
}
