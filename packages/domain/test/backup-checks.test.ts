import { describe, expect, it } from "vitest";
import { evaluateBackupChecks, type DumpObject } from "../src/platform/backups.ts";

const NOW = new Date("2026-11-24T12:00:00Z");
const settings = { dumpMaxAgeHours: 26, walMaxLagMinutes: 10, drillEveryDays: 35, walArchivingExpected: false };
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const dump = (h: number, size: number): DumpObject => ({ key: `data/d-${h}.dmp`, size, lastModified: hoursAgo(h) });
const kind = (r: ReturnType<typeof evaluateBackupChecks>, k: string) => r.find((c) => c.kind === k)!;

describe("evaluateBackupChecks: dump", () => {
  const history = [dump(48, 1000), dump(72, 1010), dump(96, 990), dump(120, 1005)];

  it("is ok for a fresh dump of normal size", () => {
    const r = kind(evaluateBackupChecks({ now: NOW, settings, dumps: [dump(3, 1000), ...history], archiver: null, newestPassingDrillAt: null }), "dump");
    expect(r.ok).toBe(true);
    expect(r.detail.state).toBe("fresh");
  });

  it("flags a stale dump", () => {
    const r = kind(evaluateBackupChecks({ now: NOW, settings, dumps: [dump(30, 1000), ...history], archiver: null, newestPassingDrillAt: null }), "dump");
    expect(r.ok).toBe(false);
    expect(r.detail.state).toBe("stale");
  });

  it("flags a dump much smaller than recent ones, even when fresh", () => {
    const r = kind(evaluateBackupChecks({ now: NOW, settings, dumps: [dump(1, 100), ...history], archiver: null, newestPassingDrillAt: null }), "dump");
    expect(r.ok).toBe(false);
    expect(r.detail.state).toBe("too_small");
  });

  it("flags an empty dump, a missing dump and an unreadable bucket", () => {
    expect(kind(evaluateBackupChecks({ now: NOW, settings, dumps: [dump(1, 0)], archiver: null, newestPassingDrillAt: null }), "dump").ok).toBe(false);
    expect(kind(evaluateBackupChecks({ now: NOW, settings, dumps: [], archiver: null, newestPassingDrillAt: null }), "dump").detail.state).toBe("none_found");
    expect(kind(evaluateBackupChecks({ now: NOW, settings, dumps: { error: "AccessDenied" }, archiver: null, newestPassingDrillAt: null }), "dump").detail.state).toBe("unreadable");
  });

  it("does not judge size until there are three earlier dumps to compare with", () => {
    const r = kind(evaluateBackupChecks({ now: NOW, settings, dumps: [dump(1, 10), dump(30, 1000)], archiver: null, newestPassingDrillAt: null }), "dump");
    expect(r.ok).toBe(true);
  });
});

describe("evaluateBackupChecks: wal and drill", () => {
  type Arch = { archivedCount: number; failedCount: number; lastArchivedAt: Date | null; lastFailedAt: Date | null };
  const archiver = (minAgo: number, failedMinAgo: number | null): Arch => ({
    archivedCount: 500,
    failedCount: failedMinAgo === null ? 0 : 2,
    lastArchivedAt: new Date(NOW.getTime() - minAgo * 60_000),
    lastFailedAt: failedMinAgo === null ? null : new Date(NOW.getTime() - failedMinAgo * 60_000),
  });

  it("does not alert on WAL while archiving is not expected", () => {
    const r = kind(evaluateBackupChecks({ now: NOW, settings, dumps: [], archiver: null, newestPassingDrillAt: null }), "wal");
    expect(r.ok).toBe(true);
    expect(r.detail.state).toBe("not_expected");
  });

  it("is healthy, lagging, failing or never-archived once expected", () => {
    const s = { ...settings, walArchivingExpected: true };
    const wal = (a: Arch | null) => kind(evaluateBackupChecks({ now: NOW, settings: s, dumps: [], archiver: a, newestPassingDrillAt: null }), "wal");
    expect(wal(archiver(2, null)).detail.state).toBe("healthy");
    expect(wal(archiver(30, null)).detail.state).toBe("lagging");
    expect(wal(archiver(2, 1)).detail.state).toBe("failing");
    expect(wal(archiver(2, 120)).ok).toBe(true);
    expect(wal(null).detail.state).toBe("never_archived");
    expect(wal({ archivedCount: 0, failedCount: 0, lastArchivedAt: null, lastFailedAt: null }).ok).toBe(false);
  });

  it("requires a passing drill within the cadence", () => {
    const drill = (days: number | null) =>
      kind(evaluateBackupChecks({ now: NOW, settings, dumps: [], archiver: null, newestPassingDrillAt: days === null ? null : new Date(NOW.getTime() - days * 86_400_000) }), "drill");
    expect(drill(null).detail.state).toBe("never_drilled");
    expect(drill(10).ok).toBe(true);
    expect(drill(40).detail.state).toBe("overdue");
  });
});
