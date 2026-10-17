/** Retention before a store's data can be purged (owner decision 2026-10-17): 30 days after the deletion was requested. */
export const PURGE_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The first moment the purge may be approved: the later of the scheduled date and requested + 30 days. */
export function purgeAvailableFrom(d: { scheduledFor: Date; createdAt: Date }): Date {
  return new Date(Math.max(d.scheduledFor.getTime(), d.createdAt.getTime() + PURGE_RETENTION_DAYS * DAY_MS));
}
