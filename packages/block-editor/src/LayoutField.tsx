import { useState, type CSSProperties, type ReactNode } from "react";
import { usePuck, type CustomField } from "@puckeditor/core";
import { LAYOUT_RULES, inheritedLayoutValue, isValidLayoutValue, type Layout, type LayoutDevice, type LayoutKey } from "@bs/blocks";
import { DEVICE_FOR_WIDTH, EDITOR_VIEWPORTS } from "./viewports.ts";

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
const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "#18181b", margin: "14px 0 8px" };

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

/** Top / left + right / bottom inputs laid out like the box they describe. */
function Box({ title, keys, layoutValue, inheritedFor, set }: { title: string; keys: [LayoutKey, LayoutKey, LayoutKey, LayoutKey]; layoutValue: (k: LayoutKey) => string | undefined; inheritedFor: (k: LayoutKey) => string | undefined; set: (k: LayoutKey, v: string | undefined) => void }) {
  const [top, right, bottom, left] = keys;
  const names: Record<string, string> = { top: "top", right: "right", bottom: "bottom", left: "left" };
  const field = (k: LayoutKey, side: string) => (
    <LengthInput k={k} label={`${title} ${names[side]}`} compactLabel value={layoutValue(k)} inherited={inheritedFor(k)} onChange={(v) => set(k, v)} />
  );
  return (
    <div>
      <div style={{ ...small, fontWeight: 700, color: "#18181b", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ width: "62%", margin: "0 auto" }}>{field(top, "top")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {field(left, "left")}
          {field(right, "right")}
        </div>
        <div style={{ width: "62%", margin: "0 auto" }}>{field(bottom, "bottom")}</div>
      </div>
    </div>
  );
}

function LayoutPanel({ value, onChange }: { value: Layout | undefined; onChange: (v: Layout) => void }) {
  const { appState, dispatch } = usePuck();
  const width = appState.ui.viewports.current.width;
  const device = DEVICE_FOR_WIDTH(width === "100%" ? 1280 : width);
  const layout: Layout = value ?? {};

  const setDevice = (id: LayoutDevice) => {
    const v = EDITOR_VIEWPORTS.find((x) => x.device === id);
    if (v) dispatch({ type: "setUi", ui: { viewports: { ...appState.ui.viewports, current: { width: v.width, height: v.height } } } });
  };

  const get = (k: LayoutKey) => layout[device]?.[k];
  const inheritedFor = (k: LayoutKey) => inheritedLayoutValue(layout, device, k);
  const set = (k: LayoutKey, v: string | undefined) => {
    const kept = Object.entries(layout[device] ?? {}).filter(([key, val]) => key !== k && val);
    const values = Object.fromEntries(v === undefined || v === "" ? kept : [...kept, [k, v]]);
    onChange({ ...layout, [device]: Object.keys(values).length > 0 ? values : undefined });
  };
  const hasValues = Object.keys(layout[device] ?? {}).length > 0;

  return (
    <div>
      <div role="tablist" aria-label="Device" style={{ display: "flex", gap: 4, background: "#f0f0f3", borderRadius: 8, padding: 3 }}>
        {DEVICES.map((d) => {
          const on = d.id === device;
          const set_ = Object.keys(layout[d.id] ?? {}).length > 0;
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
              {set_ ? <span aria-hidden="true" style={{ marginLeft: 4, color: "#2563eb" }}>●</span> : null}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
        <button type="button" disabled={!hasValues} onClick={() => onChange({ ...layout, [device]: undefined })} style={{ border: 0, background: "none", fontSize: 11, color: hasValues ? "#2563eb" : "#a1a1aa", cursor: hasValues ? "pointer" : "default", padding: 0 }}>
          Reset
        </button>
        <InfoTip>{device === "desktop" ? "Base values for every device." : `Overrides for ${device} and smaller. Empty fields inherit from the larger device.`}</InfoTip>
      </div>

      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Spacing</span>
        <InfoTip>
          Type a size with its unit: <strong>24px</strong>, <strong>1.5rem</strong>, <strong>2em</strong> or <strong>50%</strong> (widths). A plain number means px. Margins also accept <strong>auto</strong>.
        </InfoTip>
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        <Box title="Margin" keys={["marginTop", "marginRight", "marginBottom", "marginLeft"]} layoutValue={get} inheritedFor={inheritedFor} set={set} />
        <Box title="Padding" keys={["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]} layoutValue={get} inheritedFor={inheritedFor} set={set} />
      </div>

      <div style={sectionTitle}>Sizing</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8 }}>
        <LengthInput k="width" label="Width" value={get("width")} inherited={inheritedFor("width")} onChange={(v) => set("width", v)} />
        <LengthInput k="height" label="Height" value={get("height")} inherited={inheritedFor("height")} onChange={(v) => set("height", v)} />
        <LengthInput k="minWidth" label="Min. width" value={get("minWidth")} inherited={inheritedFor("minWidth")} onChange={(v) => set("minWidth", v)} />
        <LengthInput k="minHeight" label="Min. height" value={get("minHeight")} inherited={inheritedFor("minHeight")} onChange={(v) => set("minHeight", v)} />
        <LengthInput k="maxWidth" label="Max. width" value={get("maxWidth")} inherited={inheritedFor("maxWidth")} onChange={(v) => set("maxWidth", v)} />
        <LengthInput k="maxHeight" label="Max. height" value={get("maxHeight")} inherited={inheritedFor("maxHeight")} onChange={(v) => set("maxHeight", v)} />
        <label style={{ display: "grid", gap: 3, gridColumn: "1 / -1" }}>
          <span style={small}>Aspect ratio</span>
          <input
            aria-label="Aspect ratio"
            value={get("aspectRatio") ?? ""}
            placeholder={inheritedFor("aspectRatio") ?? "16 / 9"}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9./ ]/g, "").slice(0, 16);
              if (raw === "") set("aspectRatio", undefined);
              else if (isValidLayoutValue("aspectRatio", raw.trim()) || /^[0-9./ ]+$/.test(raw)) set("aspectRatio", raw);
            }}
            style={{ border: "1px solid #e4e4e7", borderRadius: 7, background: "#fafafa", padding: "4px 7px", fontSize: 12, color: "#18181b" }}
          />
        </label>
      </div>
    </div>
  );
}

export const layoutField = (label: string): CustomField<Layout | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <LayoutPanel value={value} onChange={onChange} />,
});
