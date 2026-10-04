import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  BUTTON_SIZES,
  BUTTON_STYLES,
  DEFAULT_BODY_WEIGHT,
  DEFAULT_HEADING_SIZES,
  DEFAULT_HEADING_WEIGHT,
  FONT_WEIGHTS,
  HEADING_LEVELS,
  MAX_HEADING_PX,
  MIN_HEADING_PX,
  SIZE_DEVICES,
  THEME_FONTS,
  THEME_RADII,
  computeThemeTokens,
  googleFontsHref,
  resolveButtonSize,
  resolveFontWeight,
  resolveHeadingSizes,
  type HeadingSizes,
  type SizeDevice,
  type BlockInstance,
  type ThemeTokensLike,
} from "@bs/blocks";
import { BlocksPreview } from "./BlocksPreview.tsx";
import { Dropdown, type DropdownOption } from "./Dropdown.tsx";
import type { BlockEditorHost } from "./context.tsx";
import { useFontLink } from "./fonts.ts";

/**
 * Theme settings: colours, fonts, corners and buttons. Used by the platform theme builder and
 * by the store's own theme customiser, so both write the same token shape. The preview renders
 * the theme's real pages with the edited tokens, so every change is visible immediately.
 */

export type ThemeTokens = ThemeTokensLike & Record<string, unknown>;

const COLOR_FIELDS = [
  { key: "primary", label: "Brand colour", hint: "Buttons, links and accents" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Page background" },
  { key: "surface", label: "Soft background", hint: "Cards and alternate sections" },
  { key: "text", label: "Text" },
] as const;

const PRESETS: Array<{ name: string; colors: Record<string, string> }> = [
  { name: "Forest", colors: { primary: "#0b6b42", secondary: "#334155", accent: "#f59e0b", background: "#ffffff", surface: "#f4f7f5", text: "#16201b" } },
  { name: "Ocean", colors: { primary: "#1d4ed8", secondary: "#334155", accent: "#06b6d4", background: "#ffffff", surface: "#f1f5fb", text: "#0f172a" } },
  { name: "Sunset", colors: { primary: "#c2410c", secondary: "#44403c", accent: "#eab308", background: "#fffbf7", surface: "#fdf1e7", text: "#2a1a10" } },
  { name: "Mono", colors: { primary: "#111827", secondary: "#4b5563", accent: "#6b7280", background: "#ffffff", surface: "#f3f4f6", text: "#111827" } },
  { name: "Midnight", colors: { primary: "#a78bfa", secondary: "#94a3b8", accent: "#f472b6", background: "#0f172a", surface: "#1e293b", text: "#f1f5f9" } },
];

const RADIUS_LABELS: Record<(typeof THEME_RADII)[number], string> = { none: "Square", sm: "Slight", md: "Rounded", lg: "Very rounded", full: "Pill" };
const FONT_OPTIONS: DropdownOption[] = THEME_FONTS.map((f) => ({ value: f, label: f }));
const RADIUS_OPTIONS: DropdownOption[] = THEME_RADII.map((r) => ({ value: r, label: RADIUS_LABELS[r] }));
const BUTTON_RADIUS_OPTIONS: DropdownOption[] = [{ value: "", label: "Same as other corners" }, ...RADIUS_OPTIONS];
const BUTTON_LABELS: Record<(typeof BUTTON_STYLES)[number], string> = { solid: "Solid", outline: "Outline", soft: "Soft" };

/** Maps stored radii (including "0.5rem" style values) onto the picker's choices. */
function radiusKey(v: string | undefined): (typeof THEME_RADII)[number] {
  if ((THEME_RADII as readonly string[]).includes(v ?? "")) return v as (typeof THEME_RADII)[number];
  const n = parseFloat(v ?? "");
  if (Number.isNaN(n)) return "md";
  if ((v ?? "").endsWith("px") && n >= 999) return "full";
  const rem = (v ?? "").endsWith("px") ? n / 16 : n;
  return rem <= 0 ? "none" : rem <= 0.3 ? "sm" : rem <= 0.6 ? "md" : rem <= 0.9 ? "lg" : "full";
}

/** Reads the editable values out of tokens in either the current or the first-launch shape. */
export function readThemeSettings(tokens: ThemeTokens) {
  const sanitized = computeThemeTokens(null, tokens);
  return {
    colors: {
      primary: sanitized["--color-primary"] ?? "#0f172a",
      secondary: sanitized["--color-secondary"] ?? "#334155",
      accent: sanitized["--color-accent"] ?? "#2563eb",
      background: sanitized["--color-background"] ?? "#ffffff",
      surface: sanitized["--color-surface"] ?? "#f8fafc",
      text: sanitized["--color-text"] ?? "#0f172a",
    } as Record<string, string>,
    sizes: resolveHeadingSizes(tokens),
    heading: String(tokens.fonts?.heading ?? tokens.typography?.headingFont ?? "Inter"),
    body: String(tokens.fonts?.body ?? tokens.typography?.bodyFont ?? "Inter"),
    radius: radiusKey(tokens.radius ?? tokens.shape?.radius),
    buttonStyle: (tokens.buttons?.style ?? tokens.shape?.buttonStyle ?? "solid") as string,
    buttonRadius: tokens.buttons?.radius ? radiusKey(tokens.buttons.radius) : "",
    uppercase: Boolean(tokens.buttons?.uppercase),
    buttonSize: resolveButtonSize(tokens.buttons?.size),
    headingWeight: String(resolveFontWeight(tokens.fonts?.["headingWeight"], DEFAULT_HEADING_WEIGHT)),
    bodyWeight: String(resolveFontWeight(tokens.fonts?.["bodyWeight"], DEFAULT_BODY_WEIGHT)),
    // What the two button colour schemes resolve to now (shown in the pickers), and what is explicitly set.
    buttonColors: {
      darkBg: sanitized["--bs-btn-dark-bg"] ?? "#0f172a",
      darkText: sanitized["--bs-btn-dark-fg"] ?? "#ffffff",
      lightBg: sanitized["--bs-btn-light-bg"] ?? "#f8fafc",
      lightText: sanitized["--bs-btn-light-fg"] ?? "#0f172a",
    } as Record<ButtonColorKey, string>,
    buttonColorsSet: {
      darkBg: tokens.buttons?.darkBg,
      darkText: tokens.buttons?.darkText,
      lightBg: tokens.buttons?.lightBg,
      lightText: tokens.buttons?.lightText,
    } as Partial<Record<ButtonColorKey, string>>,
  };
}

type ButtonColorKey = "darkBg" | "darkText" | "lightBg" | "lightText";
const WEIGHT_LABELS: Record<number, string> = { 400: "Regular (400)", 500: "Medium (500)", 600: "Semibold (600)", 700: "Bold (700)" };
const WEIGHT_OPTIONS: DropdownOption[] = FONT_WEIGHTS.map((w) => ({ value: String(w), label: WEIGHT_LABELS[w] ?? String(w) }));

const label: CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, marginBottom: 3 };
const input: CSSProperties = { width: "100%", border: "1px solid #d4d4d8", borderRadius: 7, padding: "4px 8px", fontSize: 12, background: "#fff", color: "#111" };

const accordion = {
  item: { borderBottom: "1px solid #eee" } as CSSProperties,
  head: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    background: "none",
    border: 0,
    padding: "9px 0",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    color: "#111",
    textAlign: "left",
  } as CSSProperties,
  body: { display: "grid", gap: 10, paddingBottom: 14 } as CSSProperties,
};

/**
 * A colour field: a round swatch plus its hex code. The native colour input sits invisibly over a round,
 * clipped swatch, so every colour in the panel has the same round shape (the browser's own swatch is square).
 */
function ColorField({ name, value, disabled, onPick }: { name: string; value: string; disabled?: boolean | undefined; onPick: (hex: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <label style={{ position: "relative", width: 26, height: 26, flex: "none", borderRadius: "50%", background: hex, border: "1px solid rgba(0,0,0,.18)", boxShadow: "inset 0 0 0 2px #fff", overflow: "hidden", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}>
        <input
          type="color"
          aria-label={`${name} colour`}
          value={hex}
          disabled={disabled}
          onChange={(e) => onPick(e.target.value)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "inherit", border: 0, padding: 0 }}
        />
      </label>
      <input
        type="text"
        aria-label={`${name} hex`}
        defaultValue={value}
        key={value}
        disabled={disabled}
        onBlur={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value.trim()) && onPick(e.target.value.trim())}
        style={{ ...input, fontFamily: "ui-monospace, monospace" }}
      />
    </div>
  );
}

function Field({ title, hint, children }: { title: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div>
      <span style={label}>{title}</span>
      {children}
      {hint ? <span style={{ fontSize: 11, color: "#71717a" }}>{hint}</span> : null}
    </div>
  );
}

function Section({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div style={accordion.item}>
      <button type="button" style={accordion.head} aria-expanded={open} aria-controls={`theme-section-${id}`} onClick={onToggle}>
        {title}
        <span aria-hidden="true" style={{ fontSize: 11, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          ▾
        </span>
      </button>
      {open ? (
        <div id={`theme-section-${id}`} style={accordion.body}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

const DEVICE_LABELS: Record<SizeDevice, { label: string; hint: string }> = {
  desktop: { label: "Desktop", hint: "1024px and wider" },
  tablet: { label: "Tablet", hint: "768px to 1023px" },
  mobile: { label: "Mobile", hint: "below 768px" },
};

function DeviceIcon({ device }: { device: SizeDevice }) {
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (device === "desktop")
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    );
  if (device === "tablet")
    return (
      <svg {...common}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M11 18h2" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

/** One size box. Edits are applied when the field loses focus or Enter is pressed; an invalid entry reverts. */
function SizeInput({ value, label, disabled, onCommit }: { value: number; label: string; disabled?: boolean | undefined; onCommit: (px: number) => void }) {
  const [text, setText] = useState(String(value));
  const apply = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return setText(String(value));
    const px = Math.min(MAX_HEADING_PX, Math.max(MIN_HEADING_PX, Math.round(n)));
    setText(String(px));
    if (px !== value) onCommit(px);
  };
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = Math.min(MAX_HEADING_PX, Math.max(MIN_HEADING_PX, (Number(text) || value) + (e.key === "ArrowUp" ? 1 : -1)));
            setText(String(n));
            onCommit(n);
          }
        }}
        style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 8, background: "#fafafa", padding: "4px 20px 4px 7px", fontSize: 12, color: "#18181b", fontVariantNumeric: "tabular-nums" }}
      />
      <span aria-hidden="true" style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "#a1a1aa", pointerEvents: "none" }}>
        px
      </span>
    </div>
  );
}

/**
 * Heading sizes (H1 to H6) per device. Sizes are pixels here and rem on the page, with the tablet and
 * desktop sizes applied from 768px and 1024px (mobile first). The page editor's Mobile, Tablet and Desktop
 * previews show each set.
 */
function HeadingSizesEditor({ sizes, onChange, disabled }: { sizes: HeadingSizes; onChange: (sizes: HeadingSizes) => void; disabled?: boolean | undefined }) {
  const isDefault = HEADING_LEVELS.every((l) => SIZE_DEVICES.every((d) => sizes[l][d] === DEFAULT_HEADING_SIZES[l][d]));
  return (
    <div style={{ marginTop: 6, paddingTop: 12, borderTop: "1px dashed #e4e4e7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={label}>Heading sizes</span>
        <button
          type="button"
          disabled={disabled || isDefault}
          onClick={() => onChange(structuredClone(DEFAULT_HEADING_SIZES))}
          style={{ border: 0, background: "none", fontSize: 11, color: disabled || isDefault ? "#a1a1aa" : "#2563eb", cursor: disabled || isDefault ? "default" : "pointer", padding: 0 }}
        >
          Reset
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "26px repeat(3, 1fr)", gap: 6, alignItems: "center" }}>
        <span />
        {SIZE_DEVICES.map((d) => (
          <span key={d} title={DEVICE_LABELS[d].hint} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#52525b", fontWeight: 600 }}>
            <DeviceIcon device={d} />
            {DEVICE_LABELS[d].label}
          </span>
        ))}
        {HEADING_LEVELS.map((level) => (
          <FragmentRow key={level} level={level} sizes={sizes} disabled={disabled} onChange={onChange} />
        ))}
      </div>
      <span style={{ display: "block", fontSize: 11, color: "#71717a", marginTop: 8 }}>Pixels, {MIN_HEADING_PX} to {MAX_HEADING_PX}. Desktop applies from 1024px, tablet from 768px.</span>
    </div>
  );
}

function FragmentRow({ level, sizes, disabled, onChange }: { level: (typeof HEADING_LEVELS)[number]; sizes: HeadingSizes; disabled?: boolean | undefined; onChange: (sizes: HeadingSizes) => void }) {
  return (
    <>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#18181b" }}>{level.toUpperCase()}</span>
      {SIZE_DEVICES.map((d) => (
        <SizeInput
          key={`${d}-${sizes[level][d]}`}
          value={sizes[level][d]}
          label={`${level.toUpperCase()} size on ${DEVICE_LABELS[d].label.toLowerCase()} in pixels`}
          disabled={disabled}
          onCommit={(px) => onChange({ ...sizes, [level]: { ...sizes[level], [d]: px } })}
        />
      ))}
    </>
  );
}

/** Only the button colours that are actually set are stored; the rest follow the brand colours. */
function cleanButtonColors(set: Partial<Record<ButtonColorKey, string | undefined>>): Partial<Record<ButtonColorKey, string>> {
  const out: Partial<Record<ButtonColorKey, string>> = {};
  for (const key of ["darkBg", "darkText", "lightBg", "lightText"] as const) {
    const v = set[key];
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out[key] = v;
  }
  return out;
}

export interface ThemeSettingsPanelProps {
  tokens: ThemeTokens;
  onChange: (tokens: ThemeTokens) => void;
  disabled?: boolean | undefined;
  /** Small line under the title (default: applies to every page of this theme). */
  note?: string | undefined;
}

/**
 * The theme settings as collapsible sections (Colours, Fonts, Corners, Buttons). It is the one place the
 * settings are edited: the platform theme builder shows it in the page editor's sidebar on every page, and
 * the store's theme screen shows it beside its preview. A new group of settings is a new Section here.
 */
export function ThemeSettingsPanel({ tokens, onChange, disabled, note }: ThemeSettingsPanelProps) {
  const v = useMemo(() => readThemeSettings(tokens), [tokens]);
  const [openId, setOpenId] = useState<string | null>("colors");
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  const commit = (patch: {
    colors?: Record<string, string>;
    heading?: string;
    body?: string;
    sizes?: HeadingSizes;
    radius?: string;
    buttonStyle?: string;
    buttonRadius?: string;
    uppercase?: boolean;
    buttonSize?: string;
    headingWeight?: string;
    bodyWeight?: string;
    buttonColors?: Partial<Record<ButtonColorKey, string | undefined>>;
  }) => {
    const next = { ...v, ...patch, colors: { ...v.colors, ...(patch.colors ?? {}) }, buttonColorsSet: { ...v.buttonColorsSet, ...(patch.buttonColors ?? {}) } };
    const { typography: _t, shape: _s, ...rest } = tokens;
    void _t;
    void _s;
    onChange({
      ...rest,
      // Marks these tokens as the store's look (they win over Branding settings).
      source: "theme",
      colors: next.colors,
      fonts: { heading: next.heading, body: next.body, headingWeight: Number(next.headingWeight), bodyWeight: Number(next.bodyWeight) },
      fontSizes: next.sizes,
      radius: next.radius,
      buttons: {
        style: next.buttonStyle,
        ...(next.buttonRadius ? { radius: next.buttonRadius } : {}),
        uppercase: next.uppercase,
        size: next.buttonSize,
        ...cleanButtonColors(next.buttonColorsSet),
      },
    });
  };

  return (
    <div aria-label="Theme settings" style={{ padding: "4px 16px 24px" }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 2px" }}>Theme settings</h2>
      <p style={{ fontSize: 11, color: "#71717a", margin: "0 0 4px" }}>{note ?? "Applies to every page of this theme."}</p>

      <Section id="colors" title="Colours" open={openId === "colors"} onToggle={() => toggle("colors")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              disabled={disabled}
              onClick={() => commit({ colors: p.colors })}
              style={{ border: "1px solid #d4d4d8", background: "#fff", borderRadius: 999, padding: "2px 9px 2px 5px", fontSize: 11, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span style={{ width: 14, height: 14, borderRadius: 999, background: p.colors["primary"], display: "inline-block" }} />
              {p.name}
            </button>
          ))}
        </div>
        {COLOR_FIELDS.map((f) => (
          <Field key={f.key} title={f.label} hint={"hint" in f ? f.hint : undefined}>
            <ColorField name={f.label} value={v.colors[f.key] ?? "#000000"} disabled={disabled} onPick={(hex) => commit({ colors: { [f.key]: hex } })} />
          </Field>
        ))}
      </Section>

      <Section id="fonts" title="Fonts" open={openId === "fonts"} onToggle={() => toggle("fonts")}>
        <Field title="Headings">
          <Dropdown compact ariaLabel="Heading font" value={v.heading} options={FONT_OPTIONS} disabled={disabled} onChange={(value) => commit({ heading: value })} />
        </Field>
        <Field title="Body text">
          <Dropdown compact ariaLabel="Body font" value={v.body} options={FONT_OPTIONS} disabled={disabled} onChange={(value) => commit({ body: value })} />
        </Field>
        <Field title="Heading weight">
          <Dropdown compact ariaLabel="Heading font weight" value={v.headingWeight} options={WEIGHT_OPTIONS} disabled={disabled} onChange={(value) => commit({ headingWeight: value })} />
        </Field>
        <Field title="Body weight">
          <Dropdown compact ariaLabel="Body font weight" value={v.bodyWeight} options={WEIGHT_OPTIONS} disabled={disabled} onChange={(value) => commit({ bodyWeight: value })} />
        </Field>
        <HeadingSizesEditor sizes={v.sizes} disabled={disabled} onChange={(sizes) => commit({ sizes })} />
      </Section>

      <Section id="corners" title="Corners" open={openId === "corners"} onToggle={() => toggle("corners")}>
        <Field title="Cards, images and fields">
          <Dropdown compact ariaLabel="Corner style" value={v.radius} options={RADIUS_OPTIONS} disabled={disabled} onChange={(value) => commit({ radius: value })} />
        </Field>
      </Section>

      <Section id="buttons" title="Buttons" open={openId === "buttons"} onToggle={() => toggle("buttons")}>
        <Field title="Style">
          <div role="radiogroup" aria-label="Button style" style={{ display: "flex", gap: 6 }}>
            {BUTTON_STYLES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={v.buttonStyle === s}
                disabled={disabled}
                onClick={() => commit({ buttonStyle: s })}
                style={{ flex: 1, border: `2px solid ${v.buttonStyle === s ? "#111" : "#d4d4d8"}`, background: "#fff", borderRadius: 7, padding: "4px 0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >
                {BUTTON_LABELS[s]}
              </button>
            ))}
          </div>
        </Field>
        <Field title="Size" hint="The default for every button. A button can still choose its own size.">
          <div role="radiogroup" aria-label="Button size" style={{ display: "flex", gap: 6 }}>
            {BUTTON_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={v.buttonSize === s}
                disabled={disabled}
                onClick={() => commit({ buttonSize: s })}
                style={{ flex: 1, border: `2px solid ${v.buttonSize === s ? "#111" : "#d4d4d8"}`, background: "#fff", borderRadius: 7, padding: "4px 0", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >
                {s === "sm" ? "Small" : s === "md" ? "Medium" : "Large"}
              </button>
            ))}
          </div>
        </Field>
        <Field title="Button corners">
          <Dropdown compact ariaLabel="Button corners" value={v.buttonRadius} options={BUTTON_RADIUS_OPTIONS} disabled={disabled} onChange={(value) => commit({ buttonRadius: value })} />
        </Field>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input type="checkbox" checked={v.uppercase} disabled={disabled} onChange={(e) => commit({ uppercase: e.target.checked })} />
          UPPERCASE button labels
        </label>

        <div style={{ marginTop: 6, paddingTop: 12, borderTop: "1px dashed #e4e4e7", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={label}>Button colours</span>
            <button
              type="button"
              disabled={disabled || Object.values(v.buttonColorsSet).every((x) => !x)}
              onClick={() => commit({ buttonColors: { darkBg: undefined, darkText: undefined, lightBg: undefined, lightText: undefined } })}
              style={{ border: 0, background: "none", fontSize: 11, color: disabled || Object.values(v.buttonColorsSet).every((x) => !x) ? "#a1a1aa" : "#2563eb", cursor: "pointer", padding: 0 }}
            >
              Reset
            </button>
          </div>
          <Field title="Dark button: background" hint="The main button. Also the colour of outline and soft buttons.">
            <ColorField name="Dark button background" value={v.buttonColors.darkBg} disabled={disabled} onPick={(hex) => commit({ buttonColors: { darkBg: hex } })} />
          </Field>
          <Field title="Dark button: text">
            <ColorField name="Dark button text" value={v.buttonColors.darkText} disabled={disabled} onPick={(hex) => commit({ buttonColors: { darkText: hex } })} />
          </Field>
          <Field title="Light button: background" hint="The secondary button.">
            <ColorField name="Light button background" value={v.buttonColors.lightBg} disabled={disabled} onPick={(hex) => commit({ buttonColors: { lightBg: hex } })} />
          </Field>
          <Field title="Light button: text">
            <ColorField name="Light button text" value={v.buttonColors.lightText} disabled={disabled} onPick={(hex) => commit({ buttonColors: { lightText: hex } })} />
          </Field>
        </div>
      </Section>
    </div>
  );
}

export interface ThemeSettingsEditorProps {
  tokens: ThemeTokens;
  onChange: (tokens: ThemeTokens) => void;
  /** What the preview shows: normally the theme's header + home page + footer. */
  previewBlocks: BlockInstance[];
  host: Pick<BlockEditorHost, "loadRenderData">;
  storeName?: string | undefined;
  disabled?: boolean | undefined;
}

/** The settings beside a preview of the theme: the store's own "Theme settings" screen. */
export function ThemeSettingsEditor({ tokens, onChange, previewBlocks, host, storeName, disabled }: ThemeSettingsEditorProps) {
  const themeVars = useMemo(() => computeThemeTokens(null, tokens), [tokens]);
  const fontsHref = useMemo(() => googleFontsHref(tokens), [tokens]);
  useFontLink(fontsHref);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 340px) 1fr", height: "100%", minHeight: 0 }}>
      <aside aria-label="Theme settings" style={{ overflowY: "auto", borderRight: "1px solid #e4e4e7", background: "#fff" }}>
        <ThemeSettingsPanel tokens={tokens} onChange={onChange} disabled={disabled} />
      </aside>

      <div style={{ overflow: "auto", background: "#f4f4f5", padding: 16 }}>
        <div style={{ boxShadow: "0 1px 4px rgba(0,0,0,.15)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
          <BlocksPreview blocks={previewBlocks} host={host} themeVars={themeVars} storeName={storeName} />
        </div>
      </div>
    </div>
  );
}
