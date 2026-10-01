export * from "./deletion-requests.ts";
export * from "./deletion-workflow.ts";

export const DELETION_STEPS = [
  "requested",
  "exported",
  "billing_stopped",
  "domains_disconnected",
  "media_scheduled",
  "db_purged",
  "verified",
  "deleted",
] as const;
