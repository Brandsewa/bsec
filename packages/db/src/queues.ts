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
} as const;

