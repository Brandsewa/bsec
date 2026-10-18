import { useState, type CSSProperties, type ReactNode } from "react";
import type { CustomField } from "@puckeditor/core";
import { LAYOUT_RULES, inheritedLayoutValue, isValidLayoutValue, type Corner, type Layout, type LayoutDevice, type LayoutKey } from "@bs/blocks";

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

/**
 * The layout panel: tabs for the screen (Desktop, Tablet, Mobile) and, in each tab, one row per setting with its values side
 * by side: Margin and Padding (Top, Right, Left, Bottom), Width and Height (Normal, Min, Max), then Aspect ratio and, for
 * widgets that have it, Border radius. A box a device leaves empty follows the larger device (shown as its placeholder).
 */
function LayoutPanel({ value, onChange, radius }: { value: Layout | undefined; onChange: (v: Layout) => void; radius: boolean }) {
  const layout: Layout = value ?? {};
  const [device, setDevice] = useState<LayoutDevice>("desktop");

  const get = (k: LayoutKey) => layout[device]?.[k];
  const inheritedFor = (k: LayoutKey) => inheritedLayoutValue(layout, device, k);
  const set = (k: LayoutKey, v: string | undefined) => {
    const kept = Object.entries(layout[device] ?? {}).filter(([key, val]) => key !== k && val);
    const values = Object.fromEntries(v === undefined || v === "" ? kept : [...kept, [k, v]]);
    onChange({ ...layout, [device]: Object.keys(values).length > 0 ? values : undefined });
  };
  const hasValues = Object.keys(layout[device] ?? {}).length > 0;

  const row = (title: string, cells: Array<[LayoutKey, string]>) => (
    <div key={title} style={{ display: "grid", gap: 4 }}>
      <span style={{ ...small, fontWeight: 700, color: "#18181b" }}>{title}</span>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`, gap: 6 }}>
        {cells.map(([k, caption]) => (
          <div key={k} style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <LengthInput k={k} label={`${title} ${caption} (${device})`} compactLabel value={get(k)} inherited={inheritedFor(k)} onChange={(v) => set(k, v)} />
            <span style={{ fontSize: 10, color: "#71717a", textAlign: "center" }}>{caption}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ minWidth: 0 }}>
      <div role="tablist" aria-label="Screen" style={{ display: "flex", gap: 4, background: "#f0f0f3", borderRadius: 8, padding: 3 }}>
        {DEVICES.map((d) => {
          const on = d.id === device;
          const touched = Object.keys(layout[d.id] ?? {}).length > 0;
          return (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setDevice(d.id)}
              style={{ flex: 1, border: 0, borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 600, cursor: "pointer", background: on ? "#fff" : "transparent", color: on ? "#18181b" : "#52525b", boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none" }}
            >
              {d.label}
              {touched ? (
                <span aria-hidden="true" style={{ marginLeft: 4, color: "#2563eb" }}>
                  ●
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 10px" }}>
        <button type="button" disabled={!hasValues} onClick={() => onChange({ ...layout, [device]: undefined })} style={{ border: 0, background: "none", fontSize: 11, color: hasValues ? "#2563eb" : "#a1a1aa", cursor: hasValues ? "pointer" : "default", padding: 0 }}>
          Reset {device}
        </button>
        <InfoTip>
          {device === "desktop" ? "Base values for every screen. " : `Overrides for ${device} and smaller; an empty box follows the larger screen. `}
          Type a size with its unit: <strong>24px</strong>, <strong>1.5rem</strong>, <strong>2em</strong> or <strong>50%</strong> (widths). A plain number means px. Margins also accept <strong>auto</strong>.
        </InfoTip>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {row("Margin", [["marginTop", "T"], ["marginRight", "R"], ["marginLeft", "L"], ["marginBottom", "B"]])}
        {row("Padding", [["paddingTop", "T"], ["paddingRight", "R"], ["paddingLeft", "L"], ["paddingBottom", "B"]])}
        {row("Width", [["width", "N"], ["minWidth", "Min"], ["maxWidth", "Max"]])}
        {row("Height", [["height", "N"], ["minHeight", "Min"], ["maxHeight", "Max"]])}
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ ...small, fontWeight: 700, color: "#18181b" }}>Aspect ratio</span>
          <input
            aria-label={`Aspect ratio (${device})`}
            value={get("aspectRatio") ?? ""}
            placeholder={inheritedFor("aspectRatio") ?? "16 / 9"}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9./ ]/g, "").slice(0, 16);
              set("aspectRatio", raw === "" ? undefined : raw);
            }}
            style={{ minWidth: 0, width: "100%", boxSizing: "border-box", border: "1px solid #e4e4e7", borderRadius: 7, background: "#fafafa", padding: "4px 8px", fontSize: 12, color: "#18181b", textAlign: "center" }}
          />
        </div>
        {radius ? row("Border radius", [["radius", "All corners"]]) : null}
      </div>
    </div>
  );
}

/** `radius: false` leaves out the border radius row (the Hero slider has its own slide corner controls). */
export const layoutField = (label: string, options: { radius?: boolean } = {}): CustomField<Layout | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <LayoutPanel value={value} onChange={onChange} radius={options.radius !== false} />,
});

type SlideRadiusValue = { enabled?: boolean | undefined } & { [D in LayoutDevice]?: { [C in Corner]?: string | undefined } | undefined };
const CORNER_CAPTIONS: Array<[Corner, string]> = [["topLeft", "Top left"], ["topRight", "Top right"], ["bottomRight", "Bottom right"], ["bottomLeft", "Bottom left"]];

/** Rounded corners of the carousel and its slides: a Yes / No switch, and when Yes the sizes per screen (an "All" box and one per corner). */
function SlideRadiusPanel({ value, onChange }: { value: SlideRadiusValue | undefined; onChange: (v: SlideRadiusValue) => void }) {
  const radius: SlideRadiusValue = value ?? {};
  if (!radius.enabled) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="radio" name="slide-round" checked onChange={() => undefined} />
          No
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="radio" name="slide-round" checked={false} onChange={() => onChange({ ...radius, enabled: true })} />
          Yes, round the corners
        </label>
      </div>
    );
  }
  return <SlideRadiusSizes radius={radius} onChange={onChange} />;
}

function SlideRadiusSizes({ radius, onChange }: { radius: SlideRadiusValue; onChange: (v: SlideRadiusValue) => void }) {
  const [device, setDevice] = useState<LayoutDevice>("desktop");
  const corners = radius[device] ?? {};
  const inherited = (c: Corner) => {
    const order: LayoutDevice[] = device === "mobile" ? ["tablet", "desktop"] : device === "tablet" ? ["desktop"] : [];
    for (const d of order) if (radius[d]?.[c]) return radius[d]?.[c];
    return undefined;
  };
  const setCorners = (patch: Partial<Record<Corner, string | undefined>>) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(corners)) if (v && !(k in patch)) next[k] = v;
    for (const [k, v] of Object.entries(patch)) if (v) next[k] = v;
    onChange({ ...radius, [device]: Object.keys(next).length > 0 ? next : undefined });
  };
  const values = CORNER_CAPTIONS.map(([c]) => corners[c]);
  const same = values.every((v) => v === values[0]);
  const hasValues = Object.keys(corners).length > 0;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, marginBottom: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="radio" name="slide-round" checked={false} onChange={() => onChange({ ...radius, enabled: false })} />
          No
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="radio" name="slide-round" checked onChange={() => undefined} />
          Yes, round the corners
        </label>
      </div>
      <div role="tablist" aria-label="Screen" style={{ display: "flex", gap: 4, background: "#f0f0f3", borderRadius: 8, padding: 3 }}>
        {DEVICES.map((d) => {
          const on = d.id === device;
          return (
            <button key={d.id} type="button" role="tab" aria-selected={on} onClick={() => setDevice(d.id)} style={{ flex: 1, border: 0, borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 600, cursor: "pointer", background: on ? "#fff" : "transparent", color: on ? "#18181b" : "#52525b", boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none" }}>
              {d.label}
              {Object.keys(radius[d.id] ?? {}).length > 0 ? <span aria-hidden="true" style={{ marginLeft: 4, color: "#2563eb" }}>●</span> : null}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 8px" }}>
        <button type="button" disabled={!hasValues} onClick={() => onChange({ ...radius, [device]: undefined })} style={{ border: 0, background: "none", fontSize: 11, color: hasValues ? "#2563eb" : "#a1a1aa", cursor: hasValues ? "pointer" : "default", padding: 0 }}>
          Reset {device}
        </button>
        <InfoTip>Type a size with its unit (12px, 1rem, 50%); a plain number means px. An empty box follows the larger screen, and with nothing set the corners are 16px. The corners round the whole carousel and every slide, including the text block under the picture on phones.</InfoTip>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ ...small, fontWeight: 700, color: "#18181b" }}>All corners</span>
          <LengthInput k="radius" label={`All corners (${device})`} compactLabel value={same ? values[0] : undefined} inherited={same ? inherited("topLeft") : "mixed"} onChange={(v) => setCorners(Object.fromEntries(CORNER_CAPTIONS.map(([c]) => [c, v])))} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {CORNER_CAPTIONS.map(([c, caption]) => (
            <div key={c} style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <LengthInput k="radius" label={`${caption} (${device})`} compactLabel value={corners[c]} inherited={inherited(c)} onChange={(v) => setCorners({ [c]: v })} />
              <span style={{ fontSize: 10, color: "#71717a", textAlign: "center" }}>{caption.replace("Top ", "T ").replace("Bottom ", "B ").replace("left", "L").replace("right", "R")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const slideRadiusField = (label: string): CustomField<SlideRadiusValue | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <SlideRadiusPanel value={value} onChange={onChange} />,
});
