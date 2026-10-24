import { useState, type CSSProperties, type ReactNode } from "react";
import type { BlockInstance } from "@bs/blocks";
import { Dropdown, type DropdownOption } from "./Dropdown.tsx";
import { useFrameEdit } from "./context.tsx";
import { ColorPickerSwatch } from "./ColorPickerSwatch.tsx";

/**
 * The General tab of the editor's left rail: store-wide settings that are not about one page. For now the
 * announcement bar (the theme header's Banner block): switch it on or off, write one or several messages (several
 * rotate), and set its colours and text. Everything is stored in that Banner block's props.
 */

const label: CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #d4d4d8", borderRadius: 7, padding: "4px 8px", fontSize: 12, background: "#fff", color: "#111", fontFamily: "inherit" };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, minWidth: 0 };

const ALIGN: DropdownOption[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];
const WEIGHTS: DropdownOption[] = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
];
const FONTS: DropdownOption[] = [
  { value: "body", label: "Body font" },
  { value: "heading", label: "Heading font" },
];

type Msg = { text: string; link?: string | undefined };

function Accordion({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div style={{ borderBottom: "1px solid #eee" }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", background: "none", border: 0, padding: "10px 0", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#111", textAlign: "left" }}>
        {title}
        <span aria-hidden="true" style={{ fontSize: 11, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          ▾
        </span>
      </button>
      {open ? <div style={{ ...grid, paddingBottom: 14 }}>{children}</div> : null}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span style={label}>{title}</span>
      {children}
      {hint ? <span style={{ display: "block", fontSize: 11, color: "#71717a", marginTop: 3 }}>{hint}</span> : null}
    </div>
  );
}

function TextBox({ value, onChange, max, name, placeholder }: { value: string; onChange: (v: string) => void; max: number; name: string; placeholder?: string }) {
  const [text, setText] = useState(value);
  return (
    <input
      id={name}
      type="text"
      value={text}
      maxLength={max}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      style={input}
    />
  );
}

function Check({ id, text, checked, onChange }: { id: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {text}
    </label>
  );
}

function NumberBox({ value, min, max, label: aria, onChange }: { value: number; min: number; max: number; label: string; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const apply = () => {
    const n = Math.min(max, Math.max(min, Math.round(Number(text))));
    if (!Number.isFinite(n)) return setText(String(value));
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return <input type="text" inputMode="numeric" aria-label={aria} value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()} style={input} />;
}

/** A colour that can be cleared to fall back to the theme's colour: round swatch, hex code and a reset link. */
function ColourBox({ value, onChange, name }: { value: string | undefined; onChange: (v: string | undefined) => void; name: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <ColorPickerSwatch
        label={name}
        value={value}
        onChange={onChange}
      />
      <span style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: value ? "#18181b" : "#71717a" }}>{value ?? "Theme colour"}</span>
    </div>
  );
}

const DEFAULT_BANNER: BlockInstance = {
  id: "announcement-bar",
  type: "Banner",
  version: 1,
  props: { text: "Free shipping on orders over ₹999", variant: "promo", dismissible: false },
};

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

function AnnouncementSection() {
  const edit = useFrameEdit();
  if (!edit) return null;
  const blocks = edit.frame.header;
  const index = blocks.findIndex((b) => b.type === "Banner");
  const bar = index >= 0 ? blocks[index] : undefined;
  const enabled = Boolean(bar && !bar.hidden);
  const p = (bar?.props ?? {}) as Record<string, unknown>;

  const save = (next: BlockInstance[]) => edit.setBlocks("header", next);
  const setProps = (patch: Record<string, unknown>) => {
    if (!bar) return;
    save(blocks.map((b, i) => (i === index ? { ...b, props: { ...b.props, ...patch } } : b)));
  };
  const toggle = (on: boolean) => {
    if (!bar) return on ? save([{ ...DEFAULT_BANNER }, ...blocks]) : undefined;
    save(blocks.map((b, i) => (i === index ? { ...b, hidden: !on } : b)));
  };

  const first: Msg = { text: str(p["text"]), link: str(p["link"]) || undefined };
  const extra = (Array.isArray(p["messages"]) ? (p["messages"] as Msg[]) : []).slice(0, 5);
  const setFirst = (patch: Partial<Msg>) => setProps({ text: patch.text ?? first.text, link: "link" in patch ? patch.link || undefined : first.link });
  const setExtra = (i: number, patch: Partial<Msg>) => setProps({ messages: extra.map((m, j) => (j === i ? { ...m, ...patch, link: "link" in patch ? patch.link || undefined : m.link } : m)) });
  const total = 1 + extra.length;

  return (
    <Accordion title="Announcement bar" defaultOpen>
      <Check id="gen-ann-on" text="Show the announcement bar above the header" checked={enabled} onChange={toggle} />
      {bar ? (
        <fieldset disabled={!enabled} style={{ ...grid, border: 0, padding: 0, margin: 0, opacity: enabled ? 1 : 0.5 }}>
          <Row title="Message 1">
            <div style={grid}>
              <TextBox name="gen-ann-t0" value={first.text} max={200} onChange={(v) => setFirst({ text: v || " " })} />
              <TextBox name="gen-ann-l0" value={first.link ?? ""} max={300} placeholder="Link (/collections/sale, https://…) optional" onChange={(v) => setFirst({ link: v })} />
            </div>
          </Row>
          {extra.map((m, i) => (
            <Row key={i} title={`Message ${i + 2}`}>
              <div style={grid}>
                <TextBox name={`gen-ann-t${i + 1}`} value={m.text} max={200} onChange={(v) => setExtra(i, { text: v || " " })} />
                <TextBox name={`gen-ann-l${i + 1}`} value={m.link ?? ""} max={300} placeholder="Link (optional)" onChange={(v) => setExtra(i, { link: v })} />
                <button type="button" onClick={() => setProps({ messages: extra.filter((_, j) => j !== i) })} style={{ justifySelf: "start", border: 0, background: "none", color: "#b91c1c", fontSize: 11, cursor: "pointer", padding: 0 }}>
                  Remove message
                </button>
              </div>
            </Row>
          ))}
          {total < 6 ? (
            <button type="button" onClick={() => setProps({ messages: [...extra, { text: "New message" }] })} style={{ border: "1px dashed #a1a1aa", background: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>
              + Add a message
            </button>
          ) : null}
          {total > 1 ? (
            <>
              <Check id="gen-ann-rot" text="Slide through the messages one after another" checked={p["rotate"] !== false} onChange={(v) => setProps({ rotate: v })} />
              {p["rotate"] !== false ? (
                <Row title="Seconds each message stays">
                  <NumberBox value={num(p["interval"], 5)} min={2} max={20} label="Seconds per message" onChange={(v) => setProps({ interval: v })} />
                </Row>
              ) : null}
            </>
          ) : null}
          <Row title="Text position">
            <Dropdown ariaLabel="Announcement alignment" value={str(p["align"], "center")} options={ALIGN} onChange={(v) => setProps({ align: v })} />
          </Row>
          <Row title="Background colour">
            <ColourBox name="Announcement background colour" value={str(p["bgColor"]) || undefined} onChange={(v) => setProps({ bgColor: v })} />
          </Row>
          <Row title="Text colour">
            <ColourBox name="Announcement text colour" value={str(p["textColor"]) || undefined} onChange={(v) => setProps({ textColor: v })} />
          </Row>
          <Row title="Font">
            <Dropdown ariaLabel="Announcement font" value={str(p["font"], "body")} options={FONTS} onChange={(v) => setProps({ font: v })} />
          </Row>
          <Row title="Font weight">
            <Dropdown ariaLabel="Announcement font weight" value={str(p["fontWeight"], "500")} options={WEIGHTS} onChange={(v) => setProps({ fontWeight: v })} />
          </Row>
          <Row title="Font size (px)">
            <NumberBox value={num(p["fontSize"], 14)} min={11} max={22} label="Announcement font size" onChange={(v) => setProps({ fontSize: v })} />
          </Row>
        </fieldset>
      ) : null}
    </Accordion>
  );
}

export function GeneralPanel() {
  const edit = useFrameEdit();
  if (!edit) return <></>;
  if (edit.editing === "header") {
    return <p style={{ margin: 0, padding: 12, fontSize: 12, color: "#52525b", lineHeight: 1.5 }}>You are editing the header page, where the announcement bar is a block on the page. Open any other page to manage it from here.</p>;
  }
  return (
    <div style={{ ...grid, padding: "4px 12px 20px", boxSizing: "border-box", width: "100%", overflowX: "hidden" }}>
      <AnnouncementSection />
    </div>
  );
}
