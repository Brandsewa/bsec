/**
 * Read-only listing of the backup bucket for the freshness check (docs/BACKUP-DR-PLAN.md G4).
 * Uses its own read-only R2 token (BACKUP_R2_*), never the media or Coolify credentials, and never reads object bodies.
 */
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { DumpObject } from "./backups.ts";

export interface BackupStorageEnv {
  BACKUP_R2_ENDPOINT?: string | undefined;
  BACKUP_R2_BUCKET?: string | undefined;
  BACKUP_R2_ACCESS_KEY_ID?: string | undefined;
  BACKUP_R2_SECRET_ACCESS_KEY?: string | undefined;
  /** Where Coolify puts dumps inside the bucket. */
  BACKUP_R2_PREFIX?: string | undefined;
}

/** Returns a lister, or null when the worker has no backup credentials (monitoring is then reported as not running). */
export function backupDumpLister(env: BackupStorageEnv | Record<string, string | undefined> = process.env): (() => Promise<DumpObject[]>) | null {
  const e = env as BackupStorageEnv;
  const { BACKUP_R2_ENDPOINT: endpoint, BACKUP_R2_BUCKET: bucket, BACKUP_R2_ACCESS_KEY_ID: accessKeyId, BACKUP_R2_SECRET_ACCESS_KEY: secretAccessKey } = e;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const prefix = e.BACKUP_R2_PREFIX ?? "data/";
  const client = new S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true });
  return async () => {
    const out: DumpObject[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) {
        if (o.Key && o.LastModified && o.Size !== undefined) out.push({ key: o.Key, size: o.Size, lastModified: o.LastModified });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token && out.length < 5000);
    return out;
  };
}

/** Pings a Better Stack heartbeat. Failures are swallowed: a missed ping is itself the alert. */
export async function pingHeartbeat(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}
