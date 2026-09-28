/**
 * Queue registry. Queues are created by the migrate step (as app_owner) so the runtime
 * roles never need DDL. Domain events from PLAN §11 are added here as they are built.
 */
export const QUEUES = [
  { name: "system.ping", options: { retryLimit: 5, retryBackoff: true, retryDelay: 5 } },
] as const;

export type QueueName = (typeof QUEUES)[number]["name"];
