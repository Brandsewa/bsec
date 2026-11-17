import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import type { BlockInstance } from "@bs/blocks";

/**
 * The History tab of the editor's left rail (docs/PAGE-VERSION-HISTORY-PLAN.md): every saved version of the page, a
 * read-only preview of any of them on the canvas, and a restore that is a deliberate two-step action (it makes the old
 * version the live page). Data comes from the host; the canvas preview and the "leave it" logic live in BlockEditor,
 * which gives this panel `preview` and `exitPreview` through context.
 */

export interface HistoryVersion {
  id: string;
  createdAt: string;
  note: string | null;
  createdBy: string | null;
  blockCount: number;
  isPublished: boolean;
  isDraft: boolean;
}

export interface HistoryHost {
  /** Newest first. `before` is the createdAt of the last row already shown ("load more"). */
  list: (before?: string) => Promise<HistoryVersion[]>;
  /** The blocks of one version, for the canvas preview. */
  read: (versionId: string) => Promise<BlockInstance[]>;
  /** Makes that version the live page. Resolves once the host has reloaded the page. */
  restore: (versionId: string) => Promise<void>;
  /** Restoring changes live content and needs the publish permission; reading history does not. */
  canRestore: boolean;
  /** Said in the confirm step, for example "This is the header: it appears on every page." */
  restoreWarning?: string | undefined;
}

export interface HistoryPanelState {
  host: HistoryHost;
  /** The editor has changes that are not saved yet (a restore would drop them). */
  dirty: boolean;
  /** The version currently shown on the canvas, if any. */
  previewingId: string | null;
  preview: (versionId: string, blocks: BlockInstance[], label: string) => void;
  exitPreview: () => void;
}

export const HistoryPanelContext = createContext<HistoryPanelState | null>(null);

const PAGE = 30;

const row: CSSProperties = { display: "block", width: "100%", textAlign: "left", border: "1px solid #e4e4e7", borderRadius: 8, padding: "8px 10px", background: "#fff", cursor: "pointer", color: "#111", fontFamily: "inherit" };
const badge = (bg: string, fg: string): CSSProperties => ({ display: "inline-block", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: bg, color: fg, marginLeft: 6 });
const btn: CSSProperties = { border: "1px solid #d4d4d8", borderRadius: 7, padding: "6px 10px", fontSize: 12, fontWeight: 600, background: "#fff", color: "#111", cursor: "pointer", fontFamily: "inherit" };
const btnPrimary: CSSProperties = { ...btn, background: "#111", color: "#fff", borderColor: "#111" };

export function formatVersionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The panel needs a stable identity (Puck remounts a plugin whose render function changes), so its live values come from context. */
export function HistoryPanelFromContext() {
  const state = useContext(HistoryPanelContext);
  return state ? <HistoryPanel state={state} /> : <></>;
}

function HistoryPanel({ state }: { state: HistoryPanelState }) {
  const { host, previewingId } = state;
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // First page of the list, fetched when the tab opens (state is set only when the answer arrives).
  useEffect(() => {
    let cancelled = false;
    host
      .list()
      .then((rows) => {
        if (cancelled) return;
        setVersions(rows);
        setMore(rows.length >= PAGE);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load the history.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  const loadMore = async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await host.list(before);
      if (!alive.current) return;
      setVersions((prev) => [...prev, ...rows]);
      setMore(rows.length >= PAGE);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Could not load the history.");
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  const open = async (v: HistoryVersion) => {
    if (opening) return;
    setConfirming(null);
    setOpening(v.id);
    setError(null);
    try {
      const blocks = await host.read(v.id);
      if (alive.current) state.preview(v.id, blocks, formatVersionTime(v.createdAt));
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Could not open that version.");
    } finally {
      if (alive.current) setOpening(null);
    }
  };

  const restore = async (id: string) => {
    setRestoring(true);
    setError(null);
    try {
      await host.restore(id);
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "Could not restore that version.");
        setRestoring(false);
        setConfirming(null);
      }
    }
  };

  const previewing = previewingId ? versions.find((v) => v.id === previewingId) : undefined;

  return (
    <div style={{ display: "grid", gap: 10, padding: 12, minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 12, color: "#52525b", lineHeight: 1.5 }}>Every save is kept. Open a version to look at it on the page; nothing changes until you restore it.</p>

      {previewingId ? (
        <div role="status" style={{ border: "1px solid #f59e0b", background: "#fffbeb", borderRadius: 8, padding: 10, display: "grid", gap: 8 }}>
          <strong style={{ fontSize: 12 }}>Previewing {previewing ? formatVersionTime(previewing.createdAt) : "an older version"}</strong>
          <span style={{ fontSize: 11, color: "#52525b" }}>Saving and publishing are switched off while you preview.</span>
          {confirming === previewingId ? (
            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 12, lineHeight: 1.5 }}>
                Restore this version and publish it now? It replaces the live page.{state.dirty ? " Your unsaved changes on this page will be lost." : ""}
                {host.restoreWarning ? ` ${host.restoreWarning}` : ""} The current version stays in the list, so you can undo this.
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={btnPrimary} disabled={restoring} onClick={() => void restore(previewingId)}>
                  {restoring ? "Restoring..." : "Yes, restore and publish"}
                </button>
                <button type="button" style={btn} disabled={restoring} onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {host.canRestore ? (
                <button type="button" style={btnPrimary} onClick={() => setConfirming(previewingId)}>
                  Restore this version
                </button>
              ) : (
                <span style={{ fontSize: 11, color: "#71717a" }}>You can look at versions but not restore them.</span>
              )}
              <button type="button" style={btn} onClick={state.exitPreview}>
                Back to current
              </button>
            </div>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {versions.map((v) => {
          const active = v.id === previewingId;
          return (
            <li key={v.id}>
              <button
                type="button"
                aria-pressed={active}
                disabled={Boolean(opening) || restoring}
                onClick={() => void open(v)}
                style={{ ...row, ...(active ? { borderColor: "#f59e0b", background: "#fffbeb" } : {}) }}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {formatVersionTime(v.createdAt)}
                  {v.isPublished ? <span style={badge("#dcfce7", "#166534")}>Live</span> : null}
                  {v.isDraft && !v.isPublished ? <span style={badge("#e0e7ff", "#3730a3")}>Draft</span> : null}
                </span>
                <span style={{ display: "block", fontSize: 11, color: "#71717a", marginTop: 2 }}>
                  {v.createdBy ? `${v.createdBy} · ` : ""}
                  {v.blockCount} {v.blockCount === 1 ? "block" : "blocks"}
                  {v.note ? ` · ${v.note.startsWith("Restored from ") ? "Restored" : v.note}` : ""}
                  {opening === v.id ? " · opening..." : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {loading ? <span style={{ fontSize: 12, color: "#71717a" }}>Loading...</span> : null}
      {!loading && versions.length === 0 && !error ? <span style={{ fontSize: 12, color: "#71717a" }}>No saved versions yet.</span> : null}
      {more && !loading ? (
        <button type="button" style={btn} onClick={() => void loadMore(versions[versions.length - 1]?.createdAt)}>
          Load more
        </button>
      ) : null}
    </div>
  );
}
