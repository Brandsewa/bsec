import type { StatusTone } from "@bs/ui";

/** A return's status in the shopper's words. */
export function describeReturnStatus(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case "requested":
      return { label: "Requested", tone: "warning" };
    case "approved":
      return { label: "Approved", tone: "info" };
    case "picked_up":
      return { label: "Picked up", tone: "info" };
    case "received":
      return { label: "Received", tone: "info" };
    case "refunded":
      return { label: "Refunded", tone: "success" };
    case "replaced":
      return { label: "Replaced", tone: "success" };
    case "closed":
      return { label: "Closed", tone: "neutral" };
    case "rejected":
      return { label: "Declined", tone: "destructive" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: status.replace(/_/g, " "), tone: "neutral" };
  }
}

/** The steps shown above a return, in order; a declined or cancelled return stops at its last step instead. */
export const RETURN_STEPS = ["Requested", "Approved", "Picked up", "Received", "Settled"] as const;

/** How many of RETURN_STEPS are done (1 means only "Requested"), or 0 for a declined or cancelled return. */
export function returnProgress(status: string): number {
  switch (status) {
    case "requested":
      return 1;
    case "approved":
      return 2;
    case "picked_up":
      return 3;
    case "received":
      return 4;
    case "refunded":
    case "replaced":
    case "closed":
      return 5;
    default:
      return 0;
  }
}
