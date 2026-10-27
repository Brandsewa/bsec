import { useState } from "react";
import type { CustomField } from "@puckeditor/core";
import { useHost, useRenderData } from "./context.tsx";

const box = { border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 } as const;

type GalleryItem = { mediaId: string; caption?: string | undefined; link?: string | undefined };

/**
 * The gallery's picture list: choose many pictures from the media library in one go, then drag them (or use the arrows) to
 * reorder, add a caption or remove one. Items keep their caption and link when the selection changes.
 */
export function GalleryImagesField({ value, onChange, label }: { value: GalleryItem[] | undefined; onChange: (v: GalleryItem[]) => void; label: string }) {
  const host = useHost();
  const { media } = useRenderData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const items = value ?? [];

  if (!host?.pickMedia) {
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
        <p style={{ ...box, color: "#666", margin: 0 }}>Stores add their own media after activating this theme.</p>
      </div>
    );
  }

  const choose = async () => {
    setError("");
    setBusy(true);
    try {
      const picked = await host.pickMedia?.({ accept: ["image"], multiple: true, selected: items.map((i) => i.mediaId) });
      if (!picked) return;
      setUrls((u) => ({ ...u, ...Object.fromEntries(picked.map((a) => [a.id, a.thumbnailUrl ?? a.url])) }));
      const existing = new Set(items.map((i) => i.mediaId));
      // Pictures that stay keep their place; new ones follow in the order they were picked.
      const kept = items.filter((i) => picked.some((p) => p.id === i.mediaId));
      const added = picked.filter((p) => !existing.has(p.id)).map((p) => ({ mediaId: p.id }));
      onChange([...kept, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the media library");
    } finally {
      setBusy(false);
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    if (it) next.splice(to, 0, it);
    onChange(next);
  };

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={box}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: items.length ? 8 : 0 }}>
          <button type="button" onClick={() => void choose()} disabled={busy} style={{ border: "1px solid #0b6b42", color: "#0b6b42", background: "#fff", borderRadius: 6, padding: "6px 10px", cursor: busy ? "wait" : "pointer", fontSize: 13 }}>
            {busy ? "Opening…" : items.length ? "Add or remove pictures" : "Select pictures"}
          </button>
          <span style={{ color: "#666" }}>{items.length ? `${items.length} picture${items.length === 1 ? "" : "s"}` : "None yet. You can pick many at once."}</span>
          {items.length > 0 ? (
            <button type="button" onClick={() => onChange([])} style={{ marginLeft: "auto", textDecoration: "underline", background: "none", border: 0, cursor: "pointer", fontSize: 12, color: "#b00020" }}>
              Clear all
            </button>
          ) : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))", gap: 6 }}>
          {items.map((it, i) => {
            const src = urls[it.mediaId] ?? media[it.mediaId];
            const on = selected === i;
            return (
              <button
                key={it.mediaId}
                type="button"
                draggable
                title="Drag to reorder, click to edit"
                aria-label={`Picture ${i + 1}`}
                aria-pressed={on}
                onClick={() => setSelected(on ? null : i)}
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragFrom !== null) {
                    move(dragFrom, i);
                    setSelected(i);
                  }
                  setDragFrom(null);
                }}
                onDragEnd={() => setDragFrom(null)}
                style={{ position: "relative", aspectRatio: "1 / 1", padding: 0, border: on ? "2px solid #0b6b42" : "1px solid #ddd", borderRadius: 6, overflow: "hidden", background: "#eee", cursor: "grab", opacity: dragFrom === i ? 0.4 : 1 }}
              >
                {src ? <img src={src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : null}
                <span style={{ position: "absolute", left: 3, bottom: 3, background: "rgba(0,0,0,.6)", color: "#fff", borderRadius: 4, fontSize: 10, lineHeight: 1, padding: "2px 4px" }}>{i + 1}</span>
              </button>
            );
          })}
        </div>
        {selected !== null && items[selected] ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <span style={{ color: "#666", fontSize: 12 }}>Picture {selected + 1}</span>
            <button
              type="button"
              onClick={() => {
                onChange(items.filter((_, j) => j !== selected));
                setSelected(null);
              }}
              style={{ border: "1px solid #ddd", background: "#fff", color: "#b00020", borderRadius: 4, padding: "5px 8px", fontSize: 12, cursor: "pointer" }}
            >
              Remove
            </button>
          </div>
        ) : null}
        {error ? <p role="alert" style={{ color: "#b00020", margin: "6px 0 0" }}>{error}</p> : null}
      </div>
    </div>
  );
}

/** Custom field for the gallery's pictures: multi-select from the media library, reorder, caption. */
export const galleryImagesField = (label = "Pictures"): CustomField<GalleryItem[] | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <GalleryImagesField label={label} value={value} onChange={onChange} />,
});
