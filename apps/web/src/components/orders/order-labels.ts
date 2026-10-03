/** What the shopper should understand about the order right now, in plain words. */
export function describeOrderStatus(status: string): { label: string; tone: "good" | "bad" | "neutral" } {
  switch (status) {
    case "cancelled":
      return { label: "Cancelled", tone: "bad" };
    case "delivered":
      return { label: "Delivered", tone: "good" };
    case "shipped":
    case "fulfilled":
      return { label: "On its way", tone: "good" };
    case "returned":
      return { label: "Returned", tone: "neutral" };
    default:
      return { label: "Order received", tone: "good" };
  }
}

/** The payment line of an order, from its payment status. */
export function describePayment(paymentStatus: string): string {
  switch (paymentStatus) {
    case "cod_pending":
      return "Cash on delivery: pay when your order arrives";
    case "cod_collected":
      return "Paid in cash on delivery";
    case "paid":
    case "captured":
      return "Paid";
    case "partially_refunded":
      return "Partially refunded";
    case "failed":
    case "cod_failed":
      return "Payment failed";
    case "refunded":
      return "Refunded";
    case "cancelled":
    case "voided":
      return "No payment due";
    default:
      return "Awaiting payment";
  }
}
