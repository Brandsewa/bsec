import { useState, type CSSProperties, type ReactNode } from "react";
import type { CustomField } from "@puckeditor/core";
import { LAYOUT_RULES, inheritedLayoutValue, isValidLayoutValue, type Layout, type LayoutDevice, type LayoutKey } from "@bs/blocks";

/**
 * A page-builder style layout panel for one widget: margin, padding and sizing, per device. Desktop holds the
 * base values; switching the editor to Tablet or Mobile (here, or with the canvas's own device buttons) edits that
 * device's overrides, and a field a device leaves empty inherits from the larger one (shown as the placeholder).
 * Values are typed with their unit (px, rem, em, and % where it makes sense) or are a keyword (auto, none); only
 * values that are set are stored.
 */

const DEVICES: Array<{ id: LayoutDevice; label: string }> = [
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "mobile", label: "Mobile" },
];

const small: CSSProperties = { fontSize: 11, color: "#52525b" };

/**
 * Turns what was typed into a stored value: a number with a unit ("24px", "1.5rem", "2em", "50%"), a keyword
 * ("auto", "none"), or a bare number, which means pixels. Returns undefined for an empty field and null for text
 * that is not a valid value for this field yet (it is left alone while the person is still typing it).
 */
function parseTyped(k: LayoutKey, raw: string): string | undefined | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (t === "") return undefined;
  if (LAYOUT_RULES[k].keywords.includes(t)) return t;
  const candidate = /^-?\d+(\.\d+)?$/.test(t) ? `${t}px` : t;
  return isValidLayoutValue(k, candidate) ? candidate : null;
}

/**
 * One size field. There is no unit picker: type the value with its unit (10px, 2rem, 1.5em, 50%) and it is applied as
 * soon as it is complete; a bare number is taken as pixels. While focused the field shows exactly what is typed, and when
 * it loses focus it shows the stored value (so "10" becomes "10px" and half-typed text is dropped).
 */
function LengthInput({ k, label, value, inherited, onChange, compactLabel }: { k: LayoutKey; label: string; value: string | undefined; inherited: string | undefined; onChange: (v: string | undefined) => void; compactLabel?: boolean }) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? value ?? "";
  const invalid = typed !== null && typed.trim() !== "" && parseTyped(k, typed) === null;
  return (
    <label style={{ display: "grid", gap: 3, minWidth: 0 }}>
      {compactLabel ? null : <span style={small}>{label}</span>}
      <input
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={shown}
        placeholder={inherited ?? ""}
        onFocus={() => setTyped(value ?? "")}
        onBlur={() => setTyped(null)}
        onChange={(e) => {
          setTyped(e.target.value);
          const parsed = parseTyped(k, e.target.value);
          if (parsed !== null) onChange(parsed);
        }}
        style={{ minWidth: 0, width: "100%", border: `1px solid ${invalid ? "#dc2626" : "#e4e4e7"}`, borderRadius: 7, background: "#fafafa", padding: "4px 8px", fontSize: 12, color: "#18181b", fontVariantNumeric: "tabular-nums", textAlign: "center" }}
      />
    </label>
  );
}

/** A small (i) icon that shows its message in a pop-up on hover or keyboard focus. */
function InfoTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label="Input help"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{ border: 0, background: "none", padding: 0, width: 16, height: 16, display: "grid", placeItems: "center", color: "#71717a", cursor: "help" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11v5.5M12 7.6v.1" strokeWidth="2.4" />
        </svg>
      </button>
      {open ? (
        <span role="tooltip" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, width: 210, padding: "8px 10px", borderRadius: 8, background: "#18181b", color: "#f4f4f5", fontSize: 11, fontWeight: 400, letterSpacing: 0, textTransform: "none", lineHeight: 1.45, boxShadow: "0 6px 20px rgba(0,0,0,.25)" }}>
          {children}
        </span>
      ) : null}
    </span>
  );
}

const ALL_SIDES: Record<"margin" | "padding", [LayoutKey, LayoutKey, LayoutKey, LayoutKey]> = {
  margin: ["marginTop", "marginRight", "marginBottom", "marginLeft"],
  padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
};
const COLS = "minmax(0, 0.9fr) repeat(3, minmax(0, 1fr))";

/**
 * The panel is one compact grid: a row per setting and a column per device (desktop, tablet, mobile), like the logo size
 * editor. Margin and padding take one value for all sides; "Sides" opens the four sides when they should differ. A box a
 * device leaves empty follows the larger device (shown as its placeholder). Min and max sizes and the aspect ratio sit
 * under "More".
 */
function LayoutPanel({ value, onChange }: { value: Layout | undefined; onChange: (v: Layout) => void }) {
  const layout: Layout = value ?? {};
  const [sides, setSides] = useState<{ margin: boolean; padding: boolean }>({ margin: false, padding: false });
  const [more, setMore] = useState(false);

  const get = (d: LayoutDevice, k: LayoutKey) => layout[d]?.[k];
  const inheritedFor = (d: LayoutDevice, k: LayoutKey) => inheritedLayoutValue(layout, d, k);
  const setMany = (d: LayoutDevice, patch: Partial<Record<LayoutKey, string | undefined>>) => {
    const next: Record<string, string> = {};
    for (const [key, val] of Object.entries(layout[d] ?? {})) if (val && !(key in patch)) next[key] = val;
    for (const [key, val] of Object.entries(patch)) if (val) next[key] = val;
    onChange({ ...layout, [d]: Object.keys(next).length > 0 ? next : undefined });
  };
  const hasAny = DEVICES.some((d) => Object.keys(layout[d.id] ?? {}).length > 0);

  const rowStyle: CSSProperties = { display: "grid", gridTemplateColumns: COLS, gap: 6, alignItems: "center" };
  const rowTitle: CSSProperties = { ...small, fontWeight: 600, color: "#18181b" };

  const row = (title: string, k: LayoutKey) => (
    <div key={k} style={rowStyle}>
      <span style={rowTitle}>{title}</span>
      {DEVICES.map((d) => (
        <LengthInput key={d.id} k={k} label={`${title} (${d.label})`} compactLabel value={get(d.id, k)} inherited={inheritedFor(d.id, k)} onChange={(v) => setMany(d.id, { [k]: v })} />
      ))}
    </div>
  );

  /** Margin or padding: one value for every side, or the four sides. */
  const spacing = (title: string, group: "margin" | "padding") => {
    const keys = ALL_SIDES[group];
    const open = sides[group];
    const sideNames = ["Top", "Right", "Bottom", "Left"];
    return (
      <div key={group} style={{ display: "grid", gap: 6 }}>
        <div style={rowStyle}>
          <span style={rowTitle}>
            {title}
            <button type="button" aria-expanded={open} onClick={() => setSides((s) => ({ ...s, [group]: !s[group] }))} style={{ display: "block", border: 0, background: "none", padding: 0, fontSize: 10, color: "#2563eb", cursor: "pointer" }}>
              {open ? "All sides" : "Sides"}
            </button>
          </span>
          {DEVICES.map((d) => {
            const values = keys.map((k) => get(d.id, k));
            const same = values.every((v) => v === values[0]);
            return (
              <LengthInput
                key={d.id}
                k={keys[0]}
                label={`${title} all sides (${d.label})`}
                compactLabel
                value={same ? values[0] : undefined}
                inherited={same ? inheritedFor(d.id, keys[0]) : "mixed"}
                onChange={(v) => setMany(d.id, Object.fromEntries(keys.map((k) => [k, v])))}
              />
            );
          })}
        </div>
        {open
          ? keys.map((k, i) => (
              <div key={k} style={rowStyle}>
                <span style={{ ...small, paddingLeft: 8 }}>{sideNames[i]}</span>
                {DEVICES.map((d) => (
                  <LengthInput key={d.id} k={k} label={`${title} ${(sideNames[i] ?? "").toLowerCase()} (${d.label})`} compactLabel value={get(d.id, k)} inherited={inheritedFor(d.id, k)} onChange={(v) => setMany(d.id, { [k]: v })} />
                ))}
              </div>
            ))
          : null}
      </div>
    );
  };

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <button type="button" disabled={!hasAny} onClick={() => onChange({})} style={{ border: 0, background: "none", fontSize: 11, color: hasAny ? "#2563eb" : "#a1a1aa", cursor: hasAny ? "pointer" : "default", padding: 0 }}>
          Reset all
        </button>
        <InfoTip>
          Type a size with its unit: <strong>24px</strong>, <strong>1.5rem</strong>, <strong>2em</strong> or <strong>50%</strong> (widths). A plain number means px. Margins also accept <strong>auto</strong>. An empty box follows the larger screen.
        </InfoTip>
      </div>
      <div style={{ ...rowStyle, marginBottom: 6 }}>
        <span />
        {DEVICES.map((d) => (
          <span key={d.id} style={{ ...small, fontWeight: 700, color: "#18181b", textAlign: "center" }}>
            {d.label}
          </span>
        ))}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {spacing("Margin", "margin")}
        {spacing("Padding", "padding")}
        {row("Width", "width")}
        {row("Height", "height")}
        {row("Border radius", "radius")}
      </div>
      <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} style={{ marginTop: 10, border: 0, background: "none", padding: 0, fontSize: 11, fontWeight: 600, color: "#2563eb", cursor: "pointer" }}>
        {more ? "Fewer options" : "More: min and max sizes, aspect ratio"}
      </button>
      {more ? (
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          {row("Min. width", "minWidth")}
          {row("Min. height", "minHeight")}
          {row("Max. width", "maxWidth")}
          {row("Max. height", "maxHeight")}
          <div style={rowStyle}>
            <span style={rowTitle}>Aspect ratio</span>
            {DEVICES.map((d) => (
              <input
                key={d.id}
                aria-label={`Aspect ratio (${d.label})`}
                value={get(d.id, "aspectRatio") ?? ""}
                placeholder={inheritedFor(d.id, "aspectRatio") ?? "16 / 9"}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9./ ]/g, "").slice(0, 16);
                  setMany(d.id, { aspectRatio: raw === "" ? undefined : raw });
                }}
                style={{ minWidth: 0, width: "100%", boxSizing: "border-box", border: "1px solid #e4e4e7", borderRadius: 7, background: "#fafafa", padding: "4px 6px", fontSize: 12, color: "#18181b", textAlign: "center" }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const layoutField = (label: string): CustomField<Layout | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <LayoutPanel value={value} onChange={onChange} />,
});
