import { Badge } from "@bs/ui";

/** Paise → "₹1,234" (en-IN grouping). */
export const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

const BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  paid: "default",
  cod_collected: "default",
  fulfilled: "default",
  delivered: "default",
  pending: "secondary",
  cod_pending: "secondary",
  unfulfilled: "secondary",
  partially_fulfilled: "secondary",
  failed: "destructive",
  rto: "destructive",
  cancelled: "destructive",
  refunded: "outline",
  active: "default",
  scheduled: "secondary",
  expired: "outline",
  disabled: "destructive",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={BADGE_VARIANT[status] ?? "outline"} className="capitalize">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
