import { useState, type CSSProperties, type ReactNode } from "react";
import type { CustomField } from "@puckeditor/core";
import { TRUST_DESKTOP_DEFAULTS, type TrustDeviceStyle } from "@bs/blocks";
import { Dropdown, type DropdownOption } from "./Dropdown.tsx";
import { ColorPickerSwatch } from "./ColorPickerSwatch.tsx";

type Device = "desktop" | "tablet" | "mobile";
type Styles = Partial<Record<Device, TrustDeviceStyle>>;

const DEVICES: Array<{ key: Device; label: string; hint: string }> = [
  { key: "desktop", label: "Desktop", hint: "1024px and wider" },
  { key: "tablet", label: "Tablet", hint: "768 to 1023px. Empty boxes follow desktop." },
  { key: "mobile", label: "Mobile", hint: "Under 768px. Empty boxes follow tablet." },
];

const lbl: CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #d4d4d8", borderRadius: 7, padding: "4px 8px", fontSize: 12, background: "#fff", color: "#111", fontFamily: "inherit" };

const LAYOUTS: DropdownOption[] = [
  { value: "grid", label: "Grid (all items in rows)" },
  { value: "slider", label: "Slider (swipe sideways)" },
];
const LOOKS: DropdownOption[] = [
  { value: "card", label: "Card (box around each item)" },
  { value: "plain", label: "No card (just the content)" },
];
const ICON_POSITIONS: DropdownOption[] = [
  { value: "top", label: "Above the text" },
  { value: "left", label: "Left of the text" },
];
const ALIGNS: DropdownOption[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
];

/** A whole-number box: empty means "not set" (follow the larger screen). */
function NumberBox({ value, placeholder, min, max, label, onCommit }: { value: number | undefined; placeholder: number | undefined; min: number; max: number; label: string; onCommit: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const apply = () => {
    if (text.trim() === "") return onCommit(undefined);
    const n = Number(text);
    if (!Number.isFinite(n)) return setText(value === undefined ? "" : String(value));
    const v = Math.min(max, Math.max(min, Math.round(n)));
    setText(String(v));
    onCommit(v);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={text}
      placeholder={placeholder === undefined ? "" : String(placeholder)}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") apply();
      }}
      style={input}
    />
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span style={lbl}>{title}</span>
      {children}
    </div>
  );
}

function Pick({ label, value, inherited, options, device, onChange }: { label: string; value: string | undefined; inherited: string | undefined; options: DropdownOption[]; device: Device; onChange: (v: string | undefined) => void }) {
  // Tablet and mobile get a "same as larger screen" first choice, which clears the value.
  const withInherit = device === "desktop" ? options : [{ value: "", label: `Same as ${device === "tablet" ? "desktop" : "tablet"}${inherited ? ` (${options.find((o) => o.value === inherited)?.label ?? inherited})` : ""}` }, ...options];
  return (
    <Row title={label}>
      <Dropdown ariaLabel={`${label} (${device})`} value={value ?? (device === "desktop" ? (inherited ?? "") : "")} options={withInherit} onChange={(v) => onChange(v === "" ? undefined : v)} />
    </Row>
  );
}

function Color({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <Row title={label}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ColorPickerSwatch label={label} value={value} onChange={onChange} />
        <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: value ? "#18181b" : "#71717a" }}>{value ?? "None"}</span>
      </div>
    </Row>
  );
}

/**
 * One panel for the Trust strip's look: Desktop, Tablet and Mobile tabs with the same settings in each. Tablet and
 * Mobile start empty and follow the larger screen until a value is typed or chosen.
 */
function TrustStylesEditor({ value, onChange }: { value: Styles | undefined; onChange: (v: Styles) => void }) {
  const [tab, setTab] = useState<Device>("desktop");
  const styles: Styles = value ?? {};
  const cur: TrustDeviceStyle = styles[tab] ?? {};
  // What the larger screen has, shown as the placeholder of an empty box.
  const base: TrustDeviceStyle = { ...TRUST_DESKTOP_DEFAULTS, ...(styles.desktop ?? {}), ...(tab === "mobile" ? (styles.tablet ?? {}) : {}) };
  const inh = (k: keyof TrustDeviceStyle) => (tab === "desktop" ? TRUST_DESKTOP_DEFAULTS[k as keyof typeof TRUST_DESKTOP_DEFAULTS] : base[k]);
  const set = <K extends keyof TrustDeviceStyle>(k: K, v: TrustDeviceStyle[K] | undefined) => {
    // An unset value is dropped (not stored as undefined) so the screen follows the larger one again.
    const next = Object.fromEntries(Object.entries({ ...cur, [k]: v }).filter(([, x]) => x !== undefined)) as TrustDeviceStyle;
    onChange({ ...styles, [tab]: next });
  };
  const num = (k: keyof TrustDeviceStyle, title: string, min: number, max: number) => (
    <Row title={title}>
      <NumberBox key={`${tab}-${k}`} value={cur[k] as number | undefined} placeholder={inh(k) as number | undefined} min={min} max={max} label={`${title} (${tab})`} onCommit={(v) => set(k, v as never)} />
    </Row>
  );
  const hint = DEVICES.find((d) => d.key === tab)?.hint ?? "";
  return (
    <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <span style={{ ...lbl, fontSize: 12 }}>Look on each screen size</span>
      <div role="tablist" aria-label="Screen size" style={{ display: "flex", gap: 2, border: "1px solid #e4e4e7", borderRadius: 8, padding: 2 }}>
        {DEVICES.map((d) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={tab === d.key}
            onClick={() => setTab(d.key)}
            style={{ flex: 1, border: 0, borderRadius: 6, padding: "5px 6px", fontSize: 12, cursor: "pointer", background: tab === d.key ? "#18181b" : "transparent", color: tab === d.key ? "#fff" : "#27272a" }}
          >
            {d.label}
          </button>
        ))}
      </div>
      <span style={{ fontSize: 11, color: "#71717a" }}>{hint}</span>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Pick label="Arrangement" value={cur.layout} inherited={inh("layout") as string} options={LAYOUTS} device={tab} onChange={(v) => set("layout", v as never)} />
        {num("perRow", "Items per row (visible at once in a slider)", 1, 6)}
        <Pick label="Look" value={cur.look} inherited={inh("look") as string} options={LOOKS} device={tab} onChange={(v) => set("look", v as never)} />
        <Pick label="Icon position" value={cur.iconPosition} inherited={inh("iconPosition") as string} options={ICON_POSITIONS} device={tab} onChange={(v) => set("iconPosition", v as never)} />
        <Pick label="Text alignment (icon above)" value={cur.align} inherited={inh("align") as string} options={ALIGNS} device={tab} onChange={(v) => set("align", v as never)} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {num("sectionPad", "Space above and below (px)", 0, 160)}
          {num("gap", "Space between items (px)", 0, 48)}
          {num("cardPad", "Padding inside each item (px)", 0, 48)}
          {num("radius", "Corner radius (px, card look)", 0, 32)}
          {num("iconSize", "Icon size (px)", 14, 72)}
          {num("headingSize", "Heading size (px)", 10, 32)}
          {num("textSize", "Description size (px)", 9, 24)}
        </div>
        <Color label="Strip background colour" value={cur.sectionBg} onChange={(v) => set("sectionBg", v)} />
        <Color label="Card background colour (card look)" value={cur.cardBg} onChange={(v) => set("cardBg", v)} />
      </div>
    </div>
  );
}

export const trustStylesField = (label: string): CustomField<Styles | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <TrustStylesEditor value={value} onChange={onChange} />,
});
