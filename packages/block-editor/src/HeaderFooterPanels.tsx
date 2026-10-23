import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import type { CustomField } from "@puckeditor/core";
import type { BlockInstance } from "@bs/blocks";
import { Dropdown, type DropdownOption } from "./Dropdown.tsx";
import { MenuSelect } from "./MenuField.tsx";
import { Picker } from "./MediaField.tsx";
import { useFrameEdit } from "./context.tsx";

/**
 * The Header and Footer tabs of the editor's left rail. They edit the theme's header and footer blocks from any page
 * (the canvas shows them read-only around the page), so layout, icons, logo and menus are managed in one place. The
 * values live in the SiteHeader / SiteFooter block's props, exactly what the Header and Footer pages edit.
 */

const label: CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #d4d4d8", borderRadius: 7, padding: "4px 8px", fontSize: 12, background: "#fff", color: "#111", fontFamily: "inherit" };
const box: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, padding: "12px 12px 20px", boxSizing: "border-box", width: "100%", minWidth: 0, overflowX: "hidden" };

const HEADER_LAYOUTS: DropdownOption[] = [
  { value: "left", label: "Logo left, menu next to it" },
  { value: "navCenter", label: "Logo left, menu in the middle" },
  { value: "logoCenter", label: "Menu left, logo in the middle" },
  { value: "logoRight", label: "Logo right, menu left" },
  { value: "center", label: "Stacked: logo in the middle, menu below" },
];
const FOOTER_LAYOUTS: DropdownOption[] = [
  { value: "columns", label: "Columns: brand, link columns, newsletter" },
  { value: "centered", label: "Centred: brand on top, link columns in a row" },
  { value: "compact", label: "Compact: brand and links side by side" },
];
const TONES: DropdownOption[] = [
  { value: "default", label: "Plain" },
  { value: "surface", label: "Soft background" },
  { value: "primary", label: "Brand colour" },
  { value: "dark", label: "Dark background" },
];

const SOCIAL_NETWORKS: DropdownOption[] = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "x", label: "X (Twitter)" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
];
const SOCIAL_STYLES: DropdownOption[] = [
  { value: "plain", label: "Plain icon" },
  { value: "filled", label: "Filled circle" },
  { value: "outline", label: "Outlined circle" },
];
const SOCIAL_COLORS: DropdownOption[] = [
  { value: "text", label: "Text colour" },
  { value: "brand", label: "Brand colour" },
];

/** A tiny diagram of each header layout, so the choice is visible and not only worded. */
function LayoutPreview({ layout }: { layout: string }) {
  const bar = (x: number, y: number, w: number, h = 4, o = 0.35) => <rect x={x} y={y} width={w} height={h} rx={2} fill="currentColor" opacity={o} />;
  const common = { width: "100%", height: 34, viewBox: "0 0 120 34", "aria-hidden": true } as const;
  const logo = (x: number, y = 14) => bar(x, y, 18, 6, 0.9);
  const nav = (x: number, y = 16) => [bar(x, y, 12), bar(x + 16, y, 12), bar(x + 32, y, 12)];
  const icons = (x: number, y = 15) => [<circle key="a" cx={x} cy={y + 2} r={3} fill="currentColor" opacity={0.6} />, <circle key="b" cx={x + 10} cy={y + 2} r={3} fill="currentColor" opacity={0.6} />];
  return (
    <svg {...common} style={{ background: "#f4f4f5", borderRadius: 6, color: "#3f3f46" }}>
      {layout === "left" && (<>{logo(8)}{nav(34)}{icons(100)}</>)}
      {layout === "navCenter" && (<>{logo(8)}{nav(40)}{icons(100)}</>)}
      {layout === "logoCenter" && (<>{nav(8)}{logo(51)}{icons(100)}</>)}
      {layout === "logoRight" && (<>{icons(8)}{nav(30)}{logo(94)}</>)}
      {layout === "center" && (<>{logo(51, 7)}{nav(38, 22)}{icons(100, 6)}</>)}
    </svg>
  );
}

function Field({ title, hint, children }: { title: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span style={label}>{title}</span>
      {children}
      {hint ? <span style={{ display: "block", fontSize: 11, color: "#71717a", marginTop: 3 }}>{hint}</span> : null}
    </div>
  );
}

function Toggle({ id, text, checked, onChange }: { id: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {text}
    </label>
  );
}

/** A settings group as an accordion: closed until opened, so a long panel stays short. */
function Group({ title, children, open: startOpen = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#111", textAlign: "left" }}
      >
        {title}
        <span aria-hidden="true" style={{ fontSize: 11, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          ▾
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}

function Text({ value, onChange, name, max, area }: { value: string; onChange: (v: string) => void; name: string; max?: number; area?: boolean }) {
  // Keyed by nothing: the field keeps its own text while typing, the block gets every change.
  const [text, setText] = useState(value);
  const common = {
    id: name,
    value: text,
    maxLength: max,
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      onChange(e.target.value);
    },
    style: input,
  };
  return area ? <textarea rows={3} {...common} /> : <input type="text" {...common} />;
}

type LogoBox = { width?: number | undefined; height?: number | undefined };
type LogoSizeValue = { desktop?: LogoBox; tablet?: LogoBox; mobile?: LogoBox };
const DEVICES: Array<{ key: "desktop" | "tablet" | "mobile"; label: string; hint: string }> = [
  { key: "desktop", label: "Desktop", hint: "1024px and wider" },
  { key: "tablet", label: "Tablet", hint: "768 to 1023px" },
  { key: "mobile", label: "Mobile", hint: "below 768px" },
];

/** A number box in pixels: empty means "not set" (the theme default), and a smaller screen then inherits the larger one. */
function PxInput({ value, label, min, max, onCommit }: { value: number | undefined; label: string; min: number; max: number; onCommit: (v: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const apply = () => {
    if (text.trim() === "") return onCommit(undefined);
    const n = Number(text);
    if (!Number.isFinite(n)) return setText(value === undefined ? "" : String(value));
    const px = Math.min(max, Math.max(min, Math.round(n)));
    setText(String(px));
    onCommit(px);
  };
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        placeholder="auto"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && apply()}
        style={{ ...input, paddingRight: 22 }}
      />
      <span aria-hidden="true" style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#a1a1aa", pointerEvents: "none" }}>
        px
      </span>
    </div>
  );
}

/** The logo's width and height for desktop, tablet and mobile. */
export function LogoSizeEditor({ value, onChange }: { value: LogoSizeValue | undefined; onChange: (v: LogoSizeValue) => void }) {
  const size = value ?? {};
  const set = (device: "desktop" | "tablet" | "mobile", key: "width" | "height", v: number | undefined) => {
    onChange({ ...size, [device]: { ...(size[device] ?? {}), [key]: v } });
  };
  const isDefault = DEVICES.every((d) => !size[d.key]?.width && !size[d.key]?.height);
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={label}>Logo size</span>
        <button type="button" disabled={isDefault} onClick={() => onChange({ desktop: {}, tablet: {}, mobile: {} })} style={{ border: 0, background: "none", fontSize: 11, color: isDefault ? "#a1a1aa" : "#2563eb", cursor: isDefault ? "default" : "pointer", padding: 0 }}>
          Reset
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) repeat(2, minmax(0, 1fr))", gap: 6, alignItems: "center" }}>
        <span />
        <span style={{ fontSize: 11, color: "#52525b", fontWeight: 600 }}>Width</span>
        <span style={{ fontSize: 11, color: "#52525b", fontWeight: 600 }}>Height</span>
        {DEVICES.map((d) => (
          <Fragment key={d.key}>
            <span title={d.hint} style={{ fontSize: 11, color: "#52525b", fontWeight: 600 }}>
              {d.label}
            </span>
            <PxInput value={size[d.key]?.width} label={`${d.label} logo width`} min={16} max={600} onCommit={(v) => set(d.key, "width", v)} />
            <PxInput value={size[d.key]?.height} label={`${d.label} logo height`} min={12} max={300} onCommit={(v) => set(d.key, "height", v)} />
          </Fragment>
        ))}
      </div>
      <span style={{ fontSize: 11, color: "#71717a" }}>Leave a box empty for automatic. Set only one of width or height to keep the logo's shape. Tablet and mobile follow the larger screen until set.</span>
    </div>
  );
}

function Unavailable({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, padding: 12, fontSize: 12, color: "#52525b", lineHeight: 1.5 }}>{children}</p>;
}

const asBool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const asStr = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

function useBlock(part: "header" | "footer"): { block: BlockInstance | undefined; props: Record<string, unknown>; set: (patch: Record<string, unknown>) => void; self: boolean } | null {
  const edit = useFrameEdit();
  if (!edit) return null;
  const type = part === "header" ? "SiteHeader" : "SiteFooter";
  const block = (part === "header" ? edit.frame.header : edit.frame.footer).find((b) => b.type === type);
  return { block, props: (block?.props ?? {}) as Record<string, unknown>, set: (patch) => edit.patch(part, patch), self: edit.editing === part };
}

export function HeaderPanel() {
  const h = useBlock("header");
  if (!h) return <></>;
  if (h.self) return <Unavailable>You are editing the header itself. Click it on the page to change its settings, or open any other page to manage the header from here.</Unavailable>;
  if (!h.block) return <Unavailable>This theme has no header yet. Open the Header page and add one.</Unavailable>;
  const p = h.props;
  const layout = asStr(p["layout"], "left");
  return (
    <div style={box}>
      <Field title="Layout" hint="Where the logo, the menu and the icons sit.">
        <LayoutPreview layout={layout} />
        <div style={{ marginTop: 6 }}>
          <Dropdown ariaLabel="Header layout" value={layout} options={HEADER_LAYOUTS} onChange={(v) => h.set({ layout: v })} />
        </div>
      </Field>
      <Group title="Menu and logo">
        <Field title="Navigation menu" hint="Choose a menu made in Online Store > Navigation.">
          <MenuSelect name="hf-header-menu" label="" value={asStr(p["menuHandle"]) || undefined} onChange={(v) => h.set({ menuHandle: v })} bare />
        </Field>
        <Picker label="Logo image" value={asStr(p["logoMediaId"]) || undefined} onChange={(v) => h.set({ logoMediaId: v })} accept={["image"]} />
        <LogoSizeEditor value={p["logoSize"] as LogoSizeValue | undefined} onChange={(v) => h.set({ logoSize: v })} />
        <Field title="Logo text" hint="Used when there is no logo image. Empty uses the store name.">
          <Text name="hf-header-logo" value={asStr(p["logoText"])} max={60} onChange={(v) => h.set({ logoText: v || undefined })} />
        </Field>
      </Group>
      <Group title="Icons">
        <Toggle id="hf-h-search" text="Search" checked={asBool(p["showSearch"], true)} onChange={(v) => h.set({ showSearch: v })} />
        <Toggle id="hf-h-account" text="Account (sign in)" checked={asBool(p["showAccount"], false)} onChange={(v) => h.set({ showAccount: v })} />
        <Toggle id="hf-h-cart" text="Cart" checked={asBool(p["showCart"], true)} onChange={(v) => h.set({ showCart: v })} />
      </Group>
      <Group title="Behaviour and colour">
        <Toggle id="hf-h-sticky" text="Stay at the top while scrolling" checked={asBool(p["sticky"], true)} onChange={(v) => h.set({ sticky: v })} />
        <Field title="Background">
          <Dropdown ariaLabel="Header background" value={asStr(p["tone"], "default")} options={TONES} onChange={(v) => h.set({ tone: v })} />
        </Field>
      </Group>
    </div>
  );
}

type Social = { network: string; url: string };
type Col = { title: string; menuHandle?: string | undefined; links: Array<{ label: string; href: string }> };

export function FooterPanel() {
  const f = useBlock("footer");
  if (!f) return <></>;
  if (f.self) return <Unavailable>You are editing the footer itself. Click it on the page to change its settings, or open any other page to manage the footer from here.</Unavailable>;
  if (!f.block) return <Unavailable>This theme has no footer yet. Open the Footer page and add one.</Unavailable>;
  const p = f.props;
  const columns = (Array.isArray(p["columns"]) ? (p["columns"] as Col[]) : []).slice(0, 4);
  const setColumn = (i: number, patch: Partial<Col>) => f.set({ columns: columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const socials = (Array.isArray(p["socials"]) ? (p["socials"] as Social[]) : []).slice(0, 8);
  const setSocial = (i: number, patch: Partial<Social>) => f.set({ socials: socials.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div style={box}>
      <Field title="Layout" hint="The footer's overall arrangement.">
        <Dropdown ariaLabel="Footer layout" value={asStr(p["layout"], "columns")} options={FOOTER_LAYOUTS} onChange={(v) => f.set({ layout: v })} />
      </Field>
      <Group title="Brand" open>
        <Picker label="Logo image" value={asStr(p["logoMediaId"]) || undefined} onChange={(v) => f.set({ logoMediaId: v })} accept={["image"]} />
        <LogoSizeEditor value={p["logoSize"] as LogoSizeValue | undefined} onChange={(v) => f.set({ logoSize: v })} />
        <Field title="Brand name" hint="Used when there is no logo image. Empty uses the store name.">
          <Text name="hf-footer-logo" value={asStr(p["logoText"])} max={60} onChange={(v) => f.set({ logoText: v || undefined })} />
        </Field>
        <Field title="About text">
          <Text name="hf-footer-about" area value={asStr(p["about"])} max={300} onChange={(v) => f.set({ about: v || undefined })} />
        </Field>
      </Group>
      <Group title="Link columns (up to 4)">
        <span style={{ fontSize: 11, color: "#71717a" }}>Make the menus in Online Store &gt; Navigation (for example Footer 1 to Footer 4), then choose one for each column. Long menus fold into an accordion on phones.</span>
        {columns.map((c, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, border: "1px solid #e4e4e7", borderRadius: 8, padding: 10, boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>Column {i + 1}</span>
              <button type="button" onClick={() => f.set({ columns: columns.filter((_, j) => j !== i) })} style={{ border: 0, background: "none", color: "#b91c1c", fontSize: 11, cursor: "pointer", padding: 0 }}>
                Remove
              </button>
            </div>
            <Field title="Heading">
              <Text name={`hf-footer-col-${i}`} value={c.title} max={60} onChange={(v) => setColumn(i, { title: v || "Links" })} />
            </Field>
            <Field title="Menu">
              <MenuSelect name={`hf-footer-menu-${i}`} label="" value={c.menuHandle || undefined} onChange={(v) => setColumn(i, { menuHandle: v })} bare noDefault />
            </Field>
          </div>
        ))}
        {columns.length < 4 ? (
          <button type="button" onClick={() => f.set({ columns: [...columns, { title: `Column ${columns.length + 1}`, links: [] }] })} style={{ border: "1px dashed #a1a1aa", background: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
            + Add a column
          </button>
        ) : null}
        <Toggle id="hf-f-acc" text="Fold each column into an accordion on phones" checked={asBool(p["mobileAccordion"], true)} onChange={(v) => f.set({ mobileAccordion: v })} />
      </Group>
      <Group title="Social links">
        <span style={{ fontSize: 11, color: "#71717a" }}>Icons shown under the brand. Add the networks you use and paste each full address (https://…). Remove one to hide it.</span>
        {socials.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, border: "1px solid #e4e4e7", borderRadius: 8, padding: 10, boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>{SOCIAL_NETWORKS.find((n) => n.value === s.network)?.label ?? "Link"}</span>
              <button type="button" onClick={() => f.set({ socials: socials.filter((_, j) => j !== i) })} style={{ border: 0, background: "none", color: "#b91c1c", fontSize: 11, cursor: "pointer", padding: 0 }}>
                Remove
              </button>
            </div>
            <Field title="Network">
              <Dropdown ariaLabel={`Social network ${i + 1}`} value={s.network} options={SOCIAL_NETWORKS} onChange={(v) => setSocial(i, { network: v })} />
            </Field>
            <Field title="Link">
              <Text name={`hf-footer-social-${i}`} value={s.url} max={500} onChange={(v) => setSocial(i, { url: v })} />
            </Field>
          </div>
        ))}
        {socials.length < 8 ? (
          <button type="button" onClick={() => f.set({ socials: [...socials, { network: "instagram", url: "https://" }] })} style={{ border: "1px dashed #a1a1aa", background: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
            + Add a social link
          </button>
        ) : null}
        {socials.length > 0 ? (
          <>
            <Field title="Icon style">
              <Dropdown ariaLabel="Social icon style" value={asStr(p["socialStyle"], "plain")} options={SOCIAL_STYLES} onChange={(v) => f.set({ socialStyle: v })} />
            </Field>
            <Field title="Icon colour">
              <Dropdown ariaLabel="Social icon colour" value={asStr(p["socialColor"], "text")} options={SOCIAL_COLORS} onChange={(v) => f.set({ socialColor: v })} />
            </Field>
            <Field title="Icon size (px)" hint="14 to 40.">
              <input
                type="number"
                aria-label="Social icon size in pixels"
                min={14}
                max={40}
                value={Number(p["socialSize"] ?? 20)}
                onChange={(e) => f.set({ socialSize: Math.min(40, Math.max(14, Math.round(Number(e.target.value) || 20))) })}
                style={input}
              />
            </Field>
          </>
        ) : null}
      </Group>
      <Group title="Newsletter">
        <Toggle id="hf-f-news" text="Show the newsletter sign-up" checked={asBool(p["showNewsletter"], true)} onChange={(v) => f.set({ showNewsletter: v })} />
        {asBool(p["showNewsletter"], true) ? (
          <>
            <Field title="Heading">
              <Text name="hf-footer-news-title" value={asStr(p["newsletterTitle"], "Newsletter")} max={80} onChange={(v) => f.set({ newsletterTitle: v || "Newsletter" })} />
            </Field>
            <Field title="Text">
              <Text name="hf-footer-news-text" value={asStr(p["newsletterText"])} max={200} onChange={(v) => f.set({ newsletterText: v })} />
            </Field>
          </>
        ) : null}
      </Group>
      <Group title="Bottom line and colour">
        <Field title="Copyright line" hint="Empty writes it automatically.">
          <Text name="hf-footer-copy" value={asStr(p["copyright"])} max={200} onChange={(v) => f.set({ copyright: v || undefined })} />
        </Field>
        <Field title="Background">
          <Dropdown ariaLabel="Footer background" value={asStr(p["tone"], "surface")} options={TONES} onChange={(v) => f.set({ tone: v })} />
        </Field>
      </Group>
    </div>
  );
}

/** The same size editor as a Puck field, for the Header and Footer pages' own settings. */
export const logoSizeField = (label: string): CustomField<LogoSizeValue | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <LogoSizeEditor value={value} onChange={onChange} />,
});
