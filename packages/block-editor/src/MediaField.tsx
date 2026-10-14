import { useState } from "react";
import type { CustomField } from "@puckeditor/core";
import { useHost, useRenderData, type MediaAsset, type MediaKind } from "./context.tsx";

const box = { border: "1px solid #ddd", borderRadius: 6, padding: 8, fontSize: 13 } as const;

export interface PickerProps {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  label: string;
  accept?: MediaKind[] | undefined;
}

export function Picker({
  value,
  onChange,
  label,
  accept = ["image"],
}: PickerProps) {
  const host = useHost();
  const { media } = useRenderData();
  const [openLegacy, setOpenLegacy] = useState(false);
  const [legacyAssets, setLegacyAssets] = useState<MediaAsset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!host?.pickMedia && !host?.listMedia) {
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
        <p style={{ ...box, color: "#666", margin: 0 }}>
          Stores add their own media after activating this theme.
        </p>
      </div>
    );
  }

  const choose = async () => {
    setError("");
    if (host?.pickMedia) {
      setBusy(true);
      try {
        const assets = await host.pickMedia({
          accept,
          multiple: false,
          selected: value ? [value] : [],
        });
        if (assets && assets.length > 0 && assets[0]) {
          onChange(assets[0].id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to select media");
      } finally {
        setBusy(false);
      }
      return;
    }

    // Legacy fallback
    if (host?.listMedia) {
      setOpenLegacy(true);
      try {
        setLegacyAssets(await host.listMedia());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load images");
      }
    }
  };

  const uploadLegacy = async (file: File) => {
    if (!host?.uploadMedia) return;
    setBusy(true);
    setError("");
    try {
      const asset = await host.uploadMedia(file);
      setLegacyAssets((prev) => [asset, ...(prev ?? [])]);
      onChange(asset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const currentUrl = value ? (media[value] ?? legacyAssets?.find((a) => a.id === value)?.url) : undefined;
  const isVideoKind = accept.length === 1 && accept[0] === "video";
  const isDocKind = accept.length === 1 && accept[0] === "document";

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={box}>
        {currentUrl ? (
          isVideoKind ? (
            <video
              src={currentUrl}
              controls
              preload="none"
              style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 4, marginBottom: 8 }}
            />
          ) : isDocKind ? (
            <div style={{ padding: "6px 0", fontSize: 13, color: "#111", marginBottom: 6 }}>
              📄 Document selected
            </div>
          ) : (
            <img
              src={currentUrl}
              alt=""
              style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 4, marginBottom: 8 }}
            />
          )
        ) : (
          <p style={{ margin: "0 0 8px", color: "#666" }}>
            {value ? "File selected" : `No ${accept.join("/")} selected`}
          </p>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={choose}
            disabled={busy}
            style={{
              textDecoration: "underline",
              background: "none",
              border: 0,
              padding: 0,
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 13,
              color: "#0b6b42",
            }}
          >
            {busy ? "Opening…" : value ? "Change" : `Choose ${accept[0] ?? "file"}`}
          </button>
          {!host?.pickMedia && host?.uploadMedia ? (
            <label style={{ textDecoration: "underline", cursor: "pointer", color: "#0b6b42" }}>
              {busy ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept={accept.map((k) => (k === "image" ? "image/*" : k === "video" ? "video/*" : "*/*")).join(",")}
                hidden
                disabled={busy}
                onChange={(e) => e.target.files?.[0] && void uploadLegacy(e.target.files[0])}
              />
            </label>
          ) : null}
          {value ? (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              style={{
                textDecoration: "underline",
                background: "none",
                border: 0,
                padding: 0,
                cursor: "pointer",
                fontSize: 13,
                color: "#b00020",
              }}
            >
              Remove
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" style={{ color: "#b00020", margin: "6px 0 0" }}>
            {error}
          </p>
        ) : null}
        {openLegacy ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 8, maxHeight: 220, overflow: "auto" }}>
            {legacyAssets === null ? <span>Loading…</span> : null}
            {legacyAssets?.length === 0 ? <span>No images yet. Upload one.</span> : null}
            {legacyAssets?.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.alt ?? ""}
                onClick={() => {
                  onChange(a.id);
                  setOpenLegacy(false);
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

export function GalleryPicker({
  value = [],
  onChange,
  label,
  max,
}: {
  value: unknown[] | undefined;
  onChange: (v: unknown[] | undefined) => void;
  label: string;
  max?: number | undefined;
}) {
  const host = useHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!host?.pickMedia) {
    return (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
        <p style={{ ...box, color: "#666", margin: 0 }}>
          Stores add their own media after activating this theme.
        </p>
      </div>
    );
  }

  const choose = async () => {
    const pick = host?.pickMedia;
    if (!pick) return;
    setError("");
    setBusy(true);
    try {
      const currentIds = (value ?? [])
        .map((v) => (typeof v === "string" ? v : (v as { mediaId?: string })?.mediaId))
        .filter((id): id is string => typeof id === "string" && Boolean(id));

      const selected = await pick({
        accept: ["image"],
        multiple: true,
        max,
        selected: currentIds,
      });

      if (!selected) return;

      if (value && value.length > 0 && typeof value[0] === "object" && value[0] !== null && "mediaId" in value[0]) {
        const existingMap = new Map((value as Array<{ mediaId: string }>).map((it) => [it.mediaId, it]));
        const next = selected.map((s) => existingMap.get(s.id) ?? { mediaId: s.id, caption: s.alt ?? "" });
        onChange(next);
      } else {
        onChange(selected.map((s) => s.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to select images");
    } finally {
      setBusy(false);
    }
  };

  const count = (value ?? []).length;

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={box}>
        <p style={{ margin: "0 0 8px", color: "#666" }}>
          {count > 0 ? `${count} image${count === 1 ? "" : "s"} selected` : "No images selected"}
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={choose}
            disabled={busy}
            style={{
              textDecoration: "underline",
              background: "none",
              border: 0,
              padding: 0,
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 13,
              color: "#0b6b42",
            }}
          >
            {busy ? "Opening…" : count > 0 ? "Manage images" : "Select images"}
          </button>
          {count > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              style={{
                textDecoration: "underline",
                background: "none",
                border: 0,
                padding: 0,
                cursor: "pointer",
                fontSize: 13,
                color: "#b00020",
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" style={{ color: "#b00020", margin: "6px 0 0" }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Puck custom field that stores a media id (never a URL: URLs are resolved at render time). */
export const mediaField = (label: string): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <Picker label={label} value={value} onChange={onChange} accept={["image"]} />,
});

/** Custom field for picking video files from the media library. */
export const videoMediaField = (label = "Video"): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <Picker label={label} value={value} onChange={onChange} accept={["video"]} />,
});

/** Custom field for picking document files from the media library. */
export const fileMediaField = (label = "Document"): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <Picker label={label} value={value} onChange={onChange} accept={["document"]} />,
});

/** Custom field for picking multiple images from the media library. */
export const galleryMediaField = (
  label = "Images",
  opts?: { max?: number | undefined },
): CustomField<unknown[] | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => (
    <GalleryPicker label={label} value={value} onChange={onChange} max={opts?.max} />
  ),
});
