/**
 * Queue registry. Queues are created by the migrate step (as app_owner) so the runtime
 * roles never need DDL. Domain events from PLAN §11 are added here as they are built.
 */
export const QUEUES = [
  { name: "system.ping", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "order.created", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "order.paid", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "order.cod_confirmed", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "order.cancelled", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "reservation.expiry", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "webhook.process", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "idempotency.cleanup", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  // M5 queues (PLAN §11 domain events)
  { name: "fulfillment.created", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "fulfillment.delivered", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "fulfillment.rto", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "return.requested", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "refund.processed", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "cart.abandoned", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "cart.recovery_sweep", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "subscription.trial_expiry_sweep", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "order.preorder_date_changed", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "order.preorder_reminder_sweep", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "order.return_photo_cleanup", options: { retryLimit: 3, retryBackoff: true, retryDelay: 10 } },
  { name: "segments.refresh_counts", options: { retryLimit: 3, retryBackoff: true, retryDelay: 10 } },
  { name: "customers.refresh_metrics", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "customers.import", options: { retryLimit: 3, retryBackoff: true, retryDelay: 10 } },
  // Finance queues (docs/FINANCE-PLAN.md §3.5)
  { name: "finance.post", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
  { name: "finance.reconcile", options: { retryLimit: 3, retryBackoff: true, retryDelay: 10 } },
] as const;

export type QueueName = (typeof QUEUES)[number]["name"];

export const QUEUE_NAMES = {
  SYSTEM_PING: "system.ping",
  ORDER_CREATED: "order.created",
  ORDER_PAID: "order.paid",
  ORDER_COD_CONFIRMED: "order.cod_confirmed",
  ORDER_CANCELLED: "order.cancelled",
  RESERVATION_EXPIRY: "reservation.expiry",
  WEBHOOK_PROCESS: "webhook.process",
  IDEMPOTENCY_CLEANUP: "idempotency.cleanup",
  FULFILLMENT_CREATED: "fulfillment.created",
  FULFILLMENT_DELIVERED: "fulfillment.delivered",
  FULFILLMENT_RTO: "fulfillment.rto",
  RETURN_REQUESTED: "return.requested",
  REFUND_PROCESSED: "refund.processed",
  CART_ABANDONED: "cart.abandoned",
  CART_RECOVERY_SWEEP: "cart.recovery_sweep",
  SUBSCRIPTION_TRIAL_EXPIRY_SWEEP: "subscription.trial_expiry_sweep",
  ORDER_PREORDER_DATE_CHANGED: "order.preorder_date_changed",
  ORDER_PREORDER_REMINDER_SWEEP: "order.preorder_reminder_sweep",
  ORDER_RETURN_PHOTO_CLEANUP: "order.return_photo_cleanup",
  SEGMENTS_REFRESH_COUNTS: "segments.refresh_counts",
  CUSTOMERS_REFRESH_METRICS: "customers.refresh_metrics",
  CUSTOMERS_IMPORT: "customers.import",
  FINANCE_POST: "finance.post",
  FINANCE_RECONCILE: "finance.reconcile",
} as const;
