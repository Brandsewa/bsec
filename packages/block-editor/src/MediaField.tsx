import { useState } from "react";
import type { CustomField } from "@puckeditor/core";
import { useHost, useRenderData, type MediaAsset } from "./context.tsx";

const box = { border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 } as const;

function Picker({ value, onChange, label }: { value: string | undefined; onChange: (v: string | undefined) => void; label: string }) {
  const host = useHost();
  const { media } = useRenderData();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!host?.listMedia) {
    return <p style={{ ...box, color: "#666" }}>{label}: stores add their own images after activating this theme.</p>;
  }
  const list = host.listMedia;

  const load = async () => {
    setOpen(true);
    setError("");
    try {
      setAssets(await list());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load images");
    }
  };

  const upload = async (file: File) => {
    if (!host.uploadMedia) return;
    setBusy(true);
    setError("");
    try {
      const asset = await host.uploadMedia(file);
      setAssets((prev) => [asset, ...(prev ?? [])]);
      onChange(asset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const current = value ? (media[value] ?? assets?.find((a) => a.id === value)?.url) : undefined;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={box}>
        {current ? (
          <img src={current} alt="" style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 4, marginBottom: 8 }} />
        ) : (
          <p style={{ margin: "0 0 8px", color: "#666" }}>{value ? "Image selected" : "No image"}</p>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={load} style={{ textDecoration: "underline" }}>
            Choose image
          </button>
          {host.uploadMedia ? (
            <label style={{ textDecoration: "underline", cursor: "pointer" }}>
              {busy ? "Uploading…" : "Upload"}
              <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </label>
          ) : null}
          {value ? (
            <button type="button" onClick={() => onChange(undefined)} style={{ textDecoration: "underline" }}>
              Remove
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" style={{ color: "#b00020", margin: "6px 0 0" }}>
            {error}
          </p>
        ) : null}
        {open ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8, maxHeight: 220, overflow: "auto" }}>
            {assets === null ? <span>Loading…</span> : null}
            {assets?.length === 0 ? <span>No images yet. Upload one.</span> : null}
            {assets?.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.alt ?? ""}
                onClick={() => {
                  onChange(a.id);
                  setOpen(false);
                }}
                style={{ padding: 0, border: a.id === value ? "2px solid #0b6b42" : "1px solid #ddd", borderRadius: 4, overflow: "hidden", aspectRatio: "1 / 1" }}
              >
                <img src={a.url} alt={a.alt ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Puck custom field that stores a media id (never a URL: URLs are resolved at render time). */
export const mediaField = (label: string): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <Picker label={label} value={value} onChange={onChange} />,
});
