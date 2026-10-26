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
  resolveBodySizes,
  resolveHeadingSizes,
  DEFAULT_BODY_SIZES,
  MAX_BODY_PX,
  MIN_BODY_PX,
  DEFAULT_SITE_WIDTHS,
  resolveThemeLayout,
  sanitizeLayoutLength,
  DEFAULT_THEME_COLORS,
  resolveThemeColors,
  type ThemeColorKey,
  type HeadingSizes,
  type SizeDevice,
  type BlockInstance,
  type ThemeTokensLike,
  type ResolvedThemeLayout,
  type ResolvedDeviceLayout,
  type SpacingQuadValues,
  type SizingValues,
  type ThemeLayoutSettings,
  type ThemeLayoutDeviceSettings,
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

interface ThemeColorFieldDef {
  key: ThemeColorKey;
  label: string;
  hint?: string;
}

const COLOR_SECTIONS: Array<{
  title?: string;
  fields: ThemeColorFieldDef[];
}> = [
  {
    fields: [
      { key: "siteBackground", label: "Site Background", hint: "Overall page / canvas background" },
    ],
  },
  {
    title: "Brand Palette",
    fields: [
      { key: "primary", label: "Primary", hint: "Main brand color, primary buttons and accents" },
      { key: "secondary", label: "Secondary", hint: "Secondary actions, borders, and subtext" },
      { key: "accent1", label: "Accent 1", hint: "First accent color for callouts and highlights" },
      { key: "accent2", label: "Accent 2", hint: "Second accent color for badges and emphasis" },
    ],
  },
  {
    title: "Light Scheme",
    fields: [
      { key: "lightHeading", label: "Heading", hint: "Headings on light background" },
      { key: "lightText", label: "Text", hint: "Body text on light background" },
      { key: "lightButton", label: "Button", hint: "Button background on light scheme" },
      { key: "lightButtonText", label: "Button Text", hint: "Button text on light scheme" },
      { key: "lightBackground", label: "Backgrounds", hint: "Default section & card background on light scheme" },
    ],
  },
  {
    title: "Dark Scheme",
    fields: [
      { key: "darkHeading", label: "Heading", hint: "Headings on dark background" },
      { key: "darkText", label: "Text", hint: "Body text on dark background" },
      { key: "darkButton", label: "Button Background", hint: "Button background on dark scheme" },
      { key: "darkButtonText", label: "Button Text", hint: "Button text on dark scheme" },
      { key: "darkBackground", label: "Backgrounds", hint: "Default section & card background on dark scheme" },
    ],
  },
];

const PRESETS: Array<{ name: string; primary: string; colors: Record<string, string> }> = [
  {
    name: "Forest",
    primary: "#0b6b42",
    colors: {
      siteBackground: "#ffffff",
      primary: "#0b6b42",
      secondary: "#334155",
      accent1: "#15803d",
      accent2: "#f59e0b",
      lightHeading: "#16201b",
      lightText: "#334155",
      lightButton: "#0b6b42",
      lightButtonText: "#ffffff",
      lightBackground: "#f4f7f5",
      darkHeading: "#f4f7f5",
      darkText: "#cbd5e1",
      darkButton: "#15803d",
      darkButtonText: "#ffffff",
      darkBackground: "#10231a",
      accent: "#15803d",
      background: "#ffffff",
      surface: "#f4f7f5",
      text: "#16201b",
      dark: "#10231a",
      textOnDark: "#f4f7f5",
    },
  },
  {
    name: "Ocean",
    primary: "#1d4ed8",
    colors: {
      siteBackground: "#ffffff",
      primary: "#1d4ed8",
      secondary: "#334155",
      accent1: "#06b6d4",
      accent2: "#3b82f6",
      lightHeading: "#0f172a",
      lightText: "#334155",
      lightButton: "#1d4ed8",
      lightButtonText: "#ffffff",
      lightBackground: "#f1f5fb",
      darkHeading: "#f1f5fb",
      darkText: "#94a3b8",
      darkButton: "#06b6d4",
      darkButtonText: "#0f172a",
      darkBackground: "#0f1f3d",
      accent: "#06b6d4",
      background: "#ffffff",
      surface: "#f1f5fb",
      text: "#0f172a",
      dark: "#0f1f3d",
      textOnDark: "#f1f5fb",
    },
  },
  {
    name: "Sunset",
    primary: "#c2410c",
    colors: {
      siteBackground: "#fffbf7",
      primary: "#c2410c",
      secondary: "#44403c",
      accent1: "#eab308",
      accent2: "#f97316",
      lightHeading: "#2a1a10",
      lightText: "#44403c",
      lightButton: "#c2410c",
      lightButtonText: "#ffffff",
      lightBackground: "#fdf1e7",
      darkHeading: "#fffbf7",
      darkText: "#d6d3d1",
      darkButton: "#ea580c",
      darkButtonText: "#ffffff",
      darkBackground: "#2a1a10",
      accent: "#eab308",
      background: "#fffbf7",
      surface: "#fdf1e7",
      text: "#2a1a10",
      dark: "#2a1a10",
      textOnDark: "#fdf1e7",
    },
  },
  {
    name: "Mono",
    primary: "#111827",
    colors: {
      siteBackground: "#ffffff",
      primary: "#111827",
      secondary: "#4b5563",
      accent1: "#6b7280",
      accent2: "#9ca3af",
      lightHeading: "#111827",
      lightText: "#374151",
      lightButton: "#111827",
      lightButtonText: "#ffffff",
      lightBackground: "#f3f4f6",
      darkHeading: "#ffffff",
      darkText: "#d1d5db",
      darkButton: "#ffffff",
      darkButtonText: "#111827",
      darkBackground: "#111827",
      accent: "#6b7280",
      background: "#ffffff",
      surface: "#f3f4f6",
      text: "#111827",
      dark: "#111827",
      textOnDark: "#ffffff",
    },
  },
  {
    name: "Midnight",
    primary: "#a78bfa",
    colors: {
      siteBackground: "#0f172a",
      primary: "#a78bfa",
      secondary: "#94a3b8",
      accent1: "#f472b6",
      accent2: "#38bdf8",
      lightHeading: "#0f172a",
      lightText: "#334155",
      lightButton: "#7c3aed",
      lightButtonText: "#ffffff",
      lightBackground: "#f8fafc",
      darkHeading: "#f1f5f9",
      darkText: "#cbd5e1",
      darkButton: "#a78bfa",
      darkButtonText: "#0f172a",
      darkBackground: "#020617",
      accent: "#f472b6",
      background: "#0f172a",
      surface: "#1e293b",
      text: "#f1f5f9",
      dark: "#020617",
      textOnDark: "#f1f5f9",
    },
  },
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
  const resolvedColors = resolveThemeColors(null, tokens);
  return {
    colors: resolvedColors as Record<string, string>,
    sizes: resolveHeadingSizes(tokens),
    bodySizes: resolveBodySizes(tokens),
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
    layout: resolveThemeLayout(tokens),
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


/** A custom color row for Theme Settings: circular swatch (triggers native picker) + hex input + description below. */
function ThemeColorRow({
  title,
  hint,
  value,
  disabled,
  onChange,
}: {
  title: string;
  hint?: string | undefined;
  value: string | undefined;
  disabled?: boolean | undefined;
  onChange: (hex: string) => void;
}) {
  const hex = /^#[0-9a-f]{6}$/i.test(value ?? "") ? (value as string) : "#000000";
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <span style={label}>{title}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label
          title={`Click to pick ${title}`}
          style={{
            position: "relative",
            width: 26,
            height: 26,
            flex: "none",
            borderRadius: "50%",
            background: value || "#ffffff",
            border: "1px solid rgba(0,0,0,0.18)",
            boxShadow: "inset 0 0 0 2px #fff",
            cursor: disabled ? "not-allowed" : "pointer",
            overflow: "hidden",
            display: "inline-block",
          }}
        >
          <input
            type="color"
            aria-label={`${title} color picker`}
            value={hex}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              cursor: "pointer",
              border: 0,
              padding: 0,
            }}
          />
        </label>
        <input
          type="text"
          aria-label={`${title} hex`}
          value={value ?? ""}
          placeholder="#000000"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const trimmed = e.target.value.trim();
            if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) onChange(trimmed);
          }}
          style={{
            flex: 1,
            border: "1px solid #d4d4d8",
            borderRadius: 7,
            padding: "5px 8px",
            fontSize: 12,
            background: "#fff",
            color: "#111",
            fontFamily: "ui-monospace, monospace",
          }}
        />
      </div>
      {hint ? (
        <span style={{ display: "block", fontSize: 11, color: "#71717a", lineHeight: 1.35, marginTop: 1 }}>
          {hint}
        </span>
      ) : null}
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
function SizeInput({ value, label, disabled, min = MIN_HEADING_PX, max = MAX_HEADING_PX, onCommit }: { value: number; label: string; disabled?: boolean | undefined; min?: number; max?: number; onCommit: (px: number) => void }) {
  const [text, setText] = useState(String(value));
  const apply = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return setText(String(value));
    const px = Math.min(max, Math.max(min, Math.round(n)));
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
            const n = Math.min(max, Math.max(min, (Number(text) || value) + (e.key === "ArrowUp" ? 1 : -1)));
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
function HeadingSizesEditor({ sizes, bodySizes, onChange, disabled }: { sizes: HeadingSizes; bodySizes: Record<SizeDevice, number>; onChange: (sizes: HeadingSizes, bodySizes: Record<SizeDevice, number>) => void; disabled?: boolean | undefined }) {
  const isDefault =
    HEADING_LEVELS.every((l) => SIZE_DEVICES.every((d) => sizes[l][d] === DEFAULT_HEADING_SIZES[l][d])) &&
    SIZE_DEVICES.every((d) => bodySizes[d] === DEFAULT_BODY_SIZES[d]);
  return (
    <div style={{ marginTop: 6, paddingTop: 12, borderTop: "1px dashed #e4e4e7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={label}>Text sizes</span>
        <button
          type="button"
          disabled={disabled || isDefault}
          onClick={() => onChange(structuredClone(DEFAULT_HEADING_SIZES), { ...DEFAULT_BODY_SIZES })}
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
          <FragmentRow key={level} level={level} sizes={sizes} disabled={disabled} onChange={(next) => onChange(next, bodySizes)} />
        ))}
        <span style={{ fontSize: 12, fontWeight: 700, color: "#18181b" }}>Body</span>
        {SIZE_DEVICES.map((d) => (
          <SizeInput
            key={`body-${d}-${bodySizes[d]}`}
            value={bodySizes[d]}
            min={MIN_BODY_PX}
            max={MAX_BODY_PX}
            label={`Body text size on ${DEVICE_LABELS[d].label.toLowerCase()} in pixels`}
            disabled={disabled}
            onCommit={(px) => onChange(sizes, { ...bodySizes, [d]: px })}
          />
        ))}
      </div>
      <span style={{ display: "block", fontSize: 11, color: "#71717a", marginTop: 8 }}>Pixels: headings {MIN_HEADING_PX} to {MAX_HEADING_PX}, body {MIN_BODY_PX} to {MAX_BODY_PX}. Desktop applies from 1024px, tablet from 768px.</span>
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

function cleanThemeLayout(layout: ResolvedThemeLayout | undefined): ThemeLayoutSettings | undefined {
  if (!layout) return undefined;
  const cleanQuad = (q?: SpacingQuadValues) => {
    if (!q) return undefined;
    const res: SpacingQuadValues = {};
    if (q.top?.trim()) res.top = q.top.trim();
    if (q.right?.trim()) res.right = q.right.trim();
    if (q.bottom?.trim()) res.bottom = q.bottom.trim();
    if (q.left?.trim()) res.left = q.left.trim();
    return Object.keys(res).length > 0 ? res : undefined;
  };
  const cleanSizing = (s?: SizingValues) => {
    if (!s) return undefined;
    const res: SizingValues = {};
    if (s.width?.trim()) res.width = s.width.trim();
    if (s.minWidth?.trim()) res.minWidth = s.minWidth.trim();
    if (s.maxWidth?.trim()) res.maxWidth = s.maxWidth.trim();
    return Object.keys(res).length > 0 ? res : undefined;
  };

  const out: ThemeLayoutSettings = {};
  for (const dev of SIZE_DEVICES) {
    const devLayout = layout[dev];
    if (!devLayout) continue;
    const devOut: ThemeLayoutDeviceSettings = {};
    if (devLayout.siteWidth && devLayout.siteWidth !== DEFAULT_SITE_WIDTHS[dev]) {
      devOut.siteWidth = devLayout.siteWidth.trim();
    }
    const secMargin = cleanQuad(devLayout.section?.margin);
    const secPad = cleanQuad(devLayout.section?.padding);
    const secSizing = cleanSizing(devLayout.section?.sizing);
    if (secMargin || secPad || secSizing) {
      devOut.section = {
        ...(secMargin ? { margin: secMargin } : {}),
        ...(secPad ? { padding: secPad } : {}),
        ...(secSizing ? { sizing: secSizing } : {}),
      };
    }
    const cntMargin = cleanQuad(devLayout.container?.margin);
    const cntPad = cleanQuad(devLayout.container?.padding);
    const cntSizing = cleanSizing(devLayout.container?.sizing);
    if (cntMargin || cntPad || cntSizing) {
      devOut.container = {
        ...(cntMargin ? { margin: cntMargin } : {}),
        ...(cntPad ? { padding: cntPad } : {}),
        ...(cntSizing ? { sizing: cntSizing } : {}),
      };
    }
    if (Object.keys(devOut).length > 0) {
      out[dev] = devOut;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Text input that keeps what the person types as a local draft and commits the cleaned value on blur or Enter.
 * Committing on every keystroke re-resolved the value (`5` became `5px`, a cleared box snapped back), so editing was impossible.
 */
function LengthInput({
  value,
  placeholder,
  disabled,
  fallback,
  style,
  onCommit,
}: {
  value: string;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** Used when the box holds something that is not a length (and for a cleared box when set). */
  fallback?: string | undefined;
  style?: CSSProperties | undefined;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    const cleaned = sanitizeLayoutLength(text, fallback) ?? (text.trim() === "" ? "" : (fallback ?? ""));
    if (cleaned !== value) onCommit(cleaned);
  };
  return (
    <input
      type="text"
      value={draft ?? value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget.value);
        if (e.key === "Escape") setDraft(null);
      }}
      style={style}
    />
  );
}

function QuadInputGroup({
  values,
  disabled,
  placeholderTop = "0px",
  placeholderRight = "0px",
  placeholderBottom = "0px",
  placeholderLeft = "0px",
  onChange,
}: {
  values: SpacingQuadValues | undefined;
  disabled?: boolean | undefined;
  placeholderTop?: string | undefined;
  placeholderRight?: string | undefined;
  placeholderBottom?: string | undefined;
  placeholderLeft?: string | undefined;
  onChange: (next: SpacingQuadValues) => void;
}) {
  const sides = [
    { key: "top", label: "Top", placeholder: placeholderTop },
    { key: "right", label: "Right", placeholder: placeholderRight },
    { key: "bottom", label: "Bottom", placeholder: placeholderBottom },
    { key: "left", label: "Left", placeholder: placeholderLeft },
  ] as const;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
      {sides.map(({ key, label: sideLabel, placeholder }) => (
        <div key={key}>
          <span style={{ display: "block", fontSize: 9, color: "#71717a", marginBottom: 2 }}>{sideLabel}</span>
          <LengthInput
            value={values?.[key] ?? ""}
            placeholder={placeholder}
            disabled={disabled}
            onCommit={(next) => onChange({ ...values, [key]: next })}
            style={{ ...input, padding: "4px 6px", fontSize: 11 }}
          />
        </div>
      ))}
    </div>
  );
}

function SizingInputGroup({
  values,
  disabled,
  placeholderWidth = "100%",
  placeholderMinWidth = "none",
  placeholderMaxWidth = "100%",
  onChange,
}: {
  values: SizingValues | undefined;
  disabled?: boolean | undefined;
  placeholderWidth?: string | undefined;
  placeholderMinWidth?: string | undefined;
  placeholderMaxWidth?: string | undefined;
  onChange: (next: SizingValues) => void;
}) {
  const fields = [
    { key: "width", label: "Width", placeholder: placeholderWidth },
    { key: "minWidth", label: "Min W", placeholder: placeholderMinWidth },
    { key: "maxWidth", label: "Max W", placeholder: placeholderMaxWidth },
  ] as const;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
      {fields.map(({ key, label: fieldLabel, placeholder }) => (
        <div key={key}>
          <span style={{ display: "block", fontSize: 9, color: "#71717a", marginBottom: 2 }}>{fieldLabel}</span>
          <LengthInput
            value={values?.[key] ?? ""}
            placeholder={placeholder}
            disabled={disabled}
            onCommit={(next) => onChange({ ...values, [key]: next })}
            style={{ ...input, padding: "4px 6px", fontSize: 11 }}
          />
        </div>
      ))}
    </div>
  );
}

function LayoutSettingsEditor({
  layout,
  disabled,
  onChange,
}: {
  layout: ResolvedThemeLayout;
  disabled?: boolean | undefined;
  onChange: (layout: ResolvedThemeLayout) => void;
}) {
  const [activeDevice, setActiveDevice] = useState<SizeDevice>("desktop");
  const currentDev = layout[activeDevice];

  const updateDev = (patch: Partial<ResolvedDeviceLayout>) => {
    onChange({
      ...layout,
      [activeDevice]: {
        ...currentDev,
        ...patch,
      },
    });
  };

  const isDefault =
    SIZE_DEVICES.every((d) => layout[d].siteWidth === DEFAULT_SITE_WIDTHS[d]) &&
    SIZE_DEVICES.every(
      (d) =>
        !layout[d].section.margin.top &&
        !layout[d].section.margin.right &&
        !layout[d].section.margin.bottom &&
        !layout[d].section.margin.left &&
        !layout[d].section.padding.top &&
        !layout[d].section.padding.right &&
        !layout[d].section.padding.bottom &&
        !layout[d].section.padding.left &&
        !layout[d].section.sizing.width &&
        !layout[d].section.sizing.minWidth &&
        !layout[d].section.sizing.maxWidth &&
        !layout[d].container.margin.top &&
        !layout[d].container.margin.right &&
        !layout[d].container.margin.bottom &&
        !layout[d].container.margin.left &&
        !layout[d].container.padding.top &&
        !layout[d].container.padding.right &&
        !layout[d].container.padding.bottom &&
        !layout[d].container.padding.left &&
        !layout[d].container.sizing.width &&
        !layout[d].container.sizing.minWidth &&
        !layout[d].container.sizing.maxWidth
    );

  const resetAll = () => {
    onChange(resolveThemeLayout({}));
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4, background: "#f4f4f5", padding: 3, borderRadius: 8, flex: 1, maxWidth: 230 }}>
          {SIZE_DEVICES.map((d) => (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => setActiveDevice(d)}
              style={{
                flex: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                padding: "4px 6px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                border: 0,
                cursor: "pointer",
                background: activeDevice === d ? "#fff" : "transparent",
                color: activeDevice === d ? "#18181b" : "#71717a",
                boxShadow: activeDevice === d ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              <DeviceIcon device={d} />
              {DEVICE_LABELS[d].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={disabled || isDefault}
          onClick={resetAll}
          style={{ border: 0, background: "none", fontSize: 11, color: disabled || isDefault ? "#a1a1aa" : "#2563eb", cursor: disabled || isDefault ? "default" : "pointer", padding: "0 4px" }}
        >
          Reset
        </button>
      </div>

      <Field title="Site width" hint={`Maximum container width on ${DEVICE_LABELS[activeDevice].label.toLowerCase()} (e.g. 1200px, 100%)`}>
        <LengthInput
          value={currentDev.siteWidth}
          placeholder={DEFAULT_SITE_WIDTHS[activeDevice]}
          disabled={disabled}
          fallback={DEFAULT_SITE_WIDTHS[activeDevice]}
          onCommit={(next) => updateDev({ siteWidth: next })}
          style={input}
        />
      </Field>

      {/* Section Defaults */}
      <div style={{ borderTop: "1px dashed #e4e4e7", paddingTop: 10, display: "grid", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#18181b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Section Defaults ({DEVICE_LABELS[activeDevice].label})
        </span>

        <Field title="Section width (Min, Max, Width)">
          <SizingInputGroup
            values={currentDev.section.sizing}
            disabled={disabled}
            placeholderWidth="100%"
            placeholderMaxWidth="100%"
            onChange={(sizing) => updateDev({ section: { ...currentDev.section, sizing } })}
          />
        </Field>

        <Field title="Section margin">
          <QuadInputGroup
            values={currentDev.section.margin}
            disabled={disabled}
            onChange={(margin) => updateDev({ section: { ...currentDev.section, margin } })}
          />
        </Field>

        <Field title="Section padding">
          <QuadInputGroup
            values={currentDev.section.padding}
            disabled={disabled}
            onChange={(padding) => updateDev({ section: { ...currentDev.section, padding } })}
          />
        </Field>
      </div>

      {/* Container Defaults */}
      <div style={{ borderTop: "1px dashed #e4e4e7", paddingTop: 10, display: "grid", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#18181b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Container Defaults ({DEVICE_LABELS[activeDevice].label})
        </span>

        <Field title="Container width (Min, Max, Width)">
          <SizingInputGroup
            values={currentDev.container.sizing}
            disabled={disabled}
            placeholderWidth="100%"
            placeholderMaxWidth={currentDev.siteWidth || DEFAULT_SITE_WIDTHS[activeDevice]}
            onChange={(sizing) => updateDev({ container: { ...currentDev.container, sizing } })}
          />
        </Field>

        <Field title="Container margin">
          <QuadInputGroup
            values={currentDev.container.margin}
            disabled={disabled}
            placeholderLeft="auto"
            placeholderRight="auto"
            onChange={(margin) => updateDev({ container: { ...currentDev.container, margin } })}
          />
        </Field>

        <Field title="Container padding">
          <QuadInputGroup
            values={currentDev.container.padding}
            disabled={disabled}
            onChange={(padding) => updateDev({ container: { ...currentDev.container, padding } })}
          />
        </Field>
      </div>
    </div>
  );
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
    bodySizes?: Record<SizeDevice, number>;
    radius?: string;
    buttonStyle?: string;
    buttonRadius?: string;
    uppercase?: boolean;
    buttonSize?: string;
    headingWeight?: string;
    bodyWeight?: string;
    buttonColors?: Partial<Record<ButtonColorKey, string | undefined>>;
    layout?: ResolvedThemeLayout;
  }) => {
    const patchColors = patch.colors
      ? (() => {
          const synced = { ...patch.colors };
          if ("siteBackground" in patch.colors && !("background" in patch.colors)) synced.background = patch.colors.siteBackground;
          if ("accent1" in patch.colors && !("accent" in patch.colors)) synced.accent = patch.colors.accent1;
          if ("lightBackground" in patch.colors && !("surface" in patch.colors)) synced.surface = patch.colors.lightBackground;
          if ("lightText" in patch.colors && !("text" in patch.colors)) synced.text = patch.colors.lightText;
          if ("darkBackground" in patch.colors && !("dark" in patch.colors)) synced.dark = patch.colors.darkBackground;
          if ("darkText" in patch.colors && !("textOnDark" in patch.colors)) synced.textOnDark = patch.colors.darkText;
          return synced;
        })()
      : undefined;
    const next = {
      ...v,
      ...patch,
      colors: { ...v.colors, ...(patchColors ?? {}) },
      buttonColorsSet: { ...v.buttonColorsSet, ...(patch.buttonColors ?? {}) },
      layout: patch.layout ?? v.layout,
    };
    const { typography: _t, shape: _s, ...rest } = tokens;
    void _t;
    void _s;
    onChange({
      ...rest,
      // Marks these tokens as the store's look (they win over Branding settings).
      source: "theme",
      colors: next.colors,
      fonts: { heading: next.heading, body: next.body, headingWeight: Number(next.headingWeight), bodyWeight: Number(next.bodyWeight) },
      fontSizes: { ...next.sizes, body: next.bodySizes },
      radius: next.radius,
      buttons: {
        style: next.buttonStyle,
        ...(next.buttonRadius ? { radius: next.buttonRadius } : {}),
        uppercase: next.uppercase,
        size: next.buttonSize,
        ...cleanButtonColors(next.buttonColorsSet),
      },
      layout: cleanThemeLayout(next.layout),
    });
  };

  return (
    <div aria-label="Theme settings" style={{ padding: "4px 16px 24px" }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 2px" }}>Theme settings</h2>
      <p style={{ fontSize: 11, color: "#71717a", margin: "0 0 4px" }}>{note ?? "Applies to every page of this theme."}</p>

      <Section id="colors" title="Colours" open={openId === "colors"} onToggle={() => toggle("colors")}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              disabled={disabled}
              onClick={() => commit({ colors: p.colors })}
              style={{
                border: "1px solid #d4d4d8",
                background: "#fff",
                color: "#18181b",
                borderRadius: 999,
                padding: "3px 10px 3px 6px",
                fontSize: 11,
                cursor: disabled ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: p.primary,
                  display: "inline-block",
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
                }}
              />
              {p.name}
            </button>
          ))}
        </div>
        {COLOR_SECTIONS.map((sec, secIdx) => (
          <div key={secIdx} style={{ display: "grid", gap: 10, borderTop: secIdx > 0 ? "1px dashed #e4e4e7" : undefined, paddingTop: secIdx > 0 ? 12 : 0 }}>
            {sec.title ? (
              <span style={{ fontSize: 11, fontWeight: 700, color: "#18181b", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {sec.title}
              </span>
            ) : null}
            {sec.fields.map((f) => (
              <ThemeColorRow
                key={f.key}
                title={f.label}
                hint={f.hint}
                value={v.colors[f.key] ?? DEFAULT_THEME_COLORS[f.key]}
                disabled={disabled}
                onChange={(hex) => hex && commit({ colors: { [f.key]: hex } })}
              />
            ))}
          </div>
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
        <HeadingSizesEditor sizes={v.sizes} bodySizes={v.bodySizes} disabled={disabled} onChange={(sizes, bodySizes) => commit({ sizes, bodySizes })} />
      </Section>

      <Section id="layout" title="Layout" open={openId === "layout"} onToggle={() => toggle("layout")}>
        <LayoutSettingsEditor layout={v.layout} disabled={disabled} onChange={(layout) => commit({ layout })} />
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
          <ThemeColorRow
            title="Dark button: background"
            hint="The main button. Also the colour of outline and soft buttons."
            value={v.buttonColors.darkBg}
            disabled={disabled}
            onChange={(hex) => commit({ buttonColors: { darkBg: hex } })}
          />
          <ThemeColorRow
            title="Dark button: text"
            value={v.buttonColors.darkText}
            disabled={disabled}
            onChange={(hex) => commit({ buttonColors: { darkText: hex } })}
          />
          <ThemeColorRow
            title="Light button: background"
            hint="The secondary button."
            value={v.buttonColors.lightBg}
            disabled={disabled}
            onChange={(hex) => commit({ buttonColors: { lightBg: hex } })}
          />
          <ThemeColorRow
            title="Light button: text"
            value={v.buttonColors.lightText}
            disabled={disabled}
            onChange={(hex) => commit({ buttonColors: { lightText: hex } })}
          />
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
