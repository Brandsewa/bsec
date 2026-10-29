import { Badge } from "@bs/ui";
import { formatMoney } from "@bs/contracts/money";

/**
 * Minor units → formatted money. Accepts optional currency (defaults to "INR").
 */
export const money = (minor: number, currency = "INR") => formatMoney(minor, currency);


const BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  paid: "success",
  cod_collected: "success",
  fulfilled: "success",
  delivered: "success",
  pending: "warning",
  cod_pending: "warning",
  unfulfilled: "secondary",
  partially_fulfilled: "secondary",
  failed: "destructive",
  rto: "destructive",
  cancelled: "destructive",
  refunded: "outline",
  active: "success",
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
