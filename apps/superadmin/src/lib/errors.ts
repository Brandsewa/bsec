/** A readable message from anything that was thrown (oRPC errors, fetch failures, plain strings). */
export function messageOf(err: unknown, fallback = "Something went wrong"): string {
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return fallback;
}
