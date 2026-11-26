import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { CustomField } from "@puckeditor/core";
import { useHost, type EditorCustomField } from "./context.tsx";

/**
 * Picking a custom field of the store without typing its key. The host lists the active product custom fields
 * (`host.listCustomFields`); the editor shows them in a small popup and hands back the chosen key.
 */

const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  rich_text: "Rich text",
  image: "Image",
  dropdown: "Dropdown",
  multi_select: "Multi select",
  number: "Number",
  boolean: "Yes / No",
};

/** The store's product custom fields: null while loading, [] when there are none or the host has no store. */
export function useCustomFieldList(): { fields: EditorCustomField[] | null; supported: boolean } {
  const host = useHost();
  const list = host?.listCustomFields;
  const [fields, setFields] = useState<EditorCustomField[] | null>(null);
  useEffect(() => {
    let mounted = true;
    if (!list) return;
    list()
      .then((r) => mounted && setFields(Array.isArray(r) ? r : []))
      .catch(() => mounted && setFields([]));
    return () => {
      mounted = false;
    };
  }, [list]);
  return { fields: list ? fields : [], supported: Boolean(list) };
}

const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const dialog: CSSProperties = { width: "min(360px, 100%)", maxHeight: "min(480px, 90vh)", display: "flex", flexDirection: "column", background: "#fff", color: "#18181b", borderRadius: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", overflow: "hidden", fontFamily: "inherit" };

/** The popup: search, then one row per field. Choosing a row closes it. */
export function CustomFieldDialog({ onPick, onClose, current }: { onPick: (key: string) => void; onClose: () => void; current?: string | undefined }) {
  const { fields, supported } = useCustomFieldList();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (fields ?? []).filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.key.includes(needle));
  }, [fields, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div style={overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Choose a custom field" style={dialog}>
        <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid #e4e4e7" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 14 }}>Choose a custom field</strong>
            <button type="button" aria-label="Close" onClick={onClose} style={{ border: 0, background: "none", fontSize: 18, lineHeight: 1, cursor: "pointer", color: "#52525b" }}>×</button>
          </div>
          <p style={{ margin: "4px 0 8px", fontSize: 11, color: "#71717a" }}>Product custom fields. The value is read from each product, and nothing shows for a product that has none.</p>
          {supported && (fields?.length ?? 0) > 6 ? (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields" style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12, border: "1px solid #d4d4d8", borderRadius: 6 }} />
          ) : null}
        </div>
        <div style={{ overflowY: "auto", padding: 6 }}>
          {!supported ? (
            <p style={{ margin: 10, fontSize: 12, color: "#52525b" }}>Custom fields belong to a store, so they are available when you edit a store page.</p>
          ) : fields === null ? (
            <p style={{ margin: 10, fontSize: 12, color: "#52525b" }}>Loading…</p>
          ) : shown.length === 0 ? (
            <p style={{ margin: 10, fontSize: 12, color: "#52525b" }}>{fields.length === 0 ? "No custom fields yet. Create them under Settings > Custom fields (Growth plan and above)." : "No field matches your search."}</p>
          ) : (
            shown.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  onPick(f.key);
                  onClose();
                }}
                style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", padding: "8px 10px", border: 0, borderRadius: 6, background: f.key === current ? "#f4f4f5" : "transparent", cursor: "pointer", fontFamily: "inherit", color: "inherit" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f4f4f5")}
                onMouseLeave={(e) => (e.currentTarget.style.background = f.key === current ? "#f4f4f5" : "transparent")}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{f.name}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#71717a", fontFamily: "ui-monospace, monospace" }}>{f.key}</span>
                </span>
                <span style={{ flex: "none", fontSize: 10, color: "#52525b", background: "#f4f4f5", border: "1px solid #e4e4e7", borderRadius: 999, padding: "1px 8px" }}>{TYPE_LABELS[f.type] ?? f.type}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A small "Custom field" button that opens the popup. Used in the toolbar of the rich text field. */
export function CustomFieldButton({ onPick, style }: { onPick: (key: string) => void; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" title="Insert a custom field" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)} style={style}>
        {"{ } Custom field"}
      </button>
      {open ? <CustomFieldDialog onPick={onPick} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CustomFieldKeyControl({ value, onChange, label }: { value: string | undefined; onChange: (v: string | undefined) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const { fields } = useCustomFieldList();
  const chosen = value ? (fields ?? []).find((f) => f.key === value) : undefined;
  const btn: CSSProperties = { border: "1px solid #e4e4e7", background: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit", color: "#18181b" };
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setOpen(true)} style={{ ...btn, flex: "1 1 auto", textAlign: "left", minWidth: 0 }}>
          {value ? (
            <>
              <strong>{chosen?.name ?? value}</strong>
              <span style={{ marginLeft: 6, color: "#71717a", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{value}</span>
            </>
          ) : (
            "Choose a custom field…"
          )}
        </button>
        {value ? (
          <button type="button" onClick={() => onChange(undefined)} style={{ border: 0, background: "none", color: "#dc2626", fontSize: 11, cursor: "pointer" }}>
            Clear
          </button>
        ) : null}
      </div>
      {open ? <CustomFieldDialog current={value} onPick={onChange} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** Puck field: pick one custom field of the store from a popup (stores its key). Replaces typing the key by hand. */
export const customFieldKeyField = (label: string): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <CustomFieldKeyControl value={value} onChange={onChange} label={label} />,
});
