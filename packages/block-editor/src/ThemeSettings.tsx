import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  BUTTON_STYLES,
  THEME_FONTS,
  THEME_RADII,
  computeThemeTokens,
  googleFontsHref,
  type BlockInstance,
  type ThemeTokensLike,
} from "@bs/blocks";
import { BlocksPreview } from "./BlocksPreview.tsx";
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
    heading: tokens.fonts?.heading ?? tokens.typography?.headingFont ?? "Inter",
    body: tokens.fonts?.body ?? tokens.typography?.bodyFont ?? "Inter",
    radius: radiusKey(tokens.radius ?? tokens.shape?.radius),
    buttonStyle: (tokens.buttons?.style ?? tokens.shape?.buttonStyle ?? "solid") as string,
    buttonRadius: tokens.buttons?.radius ? radiusKey(tokens.buttons.radius) : "",
    uppercase: Boolean(tokens.buttons?.uppercase),
  };
}

const label: CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 };
const input: CSSProperties = { width: "100%", border: "1px solid #d4d4d8", borderRadius: 6, padding: "6px 8px", fontSize: 13, background: "#fff", color: "#111" };
const group: CSSProperties = { display: "grid", gap: 10, padding: "14px 0", borderBottom: "1px solid #eee" };
const groupTitle: CSSProperties = { fontSize: 13, fontWeight: 700, margin: 0 };

function Field({ title, hint, children }: { title: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div>
      <span style={label}>{title}</span>
      {children}
      {hint ? <span style={{ fontSize: 11, color: "#71717a" }}>{hint}</span> : null}
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

export function ThemeSettingsEditor({ tokens, onChange, previewBlocks, host, storeName, disabled }: ThemeSettingsEditorProps) {
  const v = useMemo(() => readThemeSettings(tokens), [tokens]);
  const themeVars = useMemo(() => computeThemeTokens(null, tokens), [tokens]);
  const fontsHref = useMemo(() => googleFontsHref(tokens), [tokens]);
  useFontLink(fontsHref);

  const commit = (patch: {
    colors?: Record<string, string>;
    heading?: string;
    body?: string;
    radius?: string;
    buttonStyle?: string;
    buttonRadius?: string;
    uppercase?: boolean;
  }) => {
    const next = { ...v, ...patch, colors: { ...v.colors, ...(patch.colors ?? {}) } };
    const { typography: _t, shape: _s, ...rest } = tokens;
    void _t;
    void _s;
    onChange({
      ...rest,
      // Marks these tokens as the store's look (they win over Branding settings).
      source: "theme",
      colors: next.colors,
      fonts: { heading: next.heading, body: next.body },
      radius: next.radius,
      buttons: {
        style: next.buttonStyle,
        ...(next.buttonRadius ? { radius: next.buttonRadius } : {}),
        uppercase: next.uppercase,
      },
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 340px) 1fr", height: "100%", minHeight: 0 }}>
      <aside aria-label="Theme settings" style={{ overflowY: "auto", padding: "8px 18px 24px", borderRight: "1px solid #e4e4e7", background: "#fff" }}>
        <section style={group}>
          <h3 style={groupTitle}>Colours</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                disabled={disabled}
                onClick={() => commit({ colors: p.colors })}
                style={{ border: "1px solid #d4d4d8", background: "#fff", borderRadius: 999, padding: "3px 10px 3px 6px", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span style={{ width: 14, height: 14, borderRadius: 999, background: p.colors["primary"], display: "inline-block" }} />
                {p.name}
              </button>
            ))}
          </div>
          {COLOR_FIELDS.map((f) => (
            <Field key={f.key} title={f.label} hint={"hint" in f ? f.hint : undefined}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="color"
                  aria-label={`${f.label} colour`}
                  value={/^#[0-9a-f]{6}$/i.test(v.colors[f.key] ?? "") ? v.colors[f.key] : "#000000"}
                  disabled={disabled}
                  onChange={(e) => commit({ colors: { [f.key]: e.target.value } })}
                  style={{ width: 40, height: 32, padding: 0, border: "1px solid #d4d4d8", borderRadius: 6, background: "none" }}
                />
                <input
                  type="text"
                  aria-label={`${f.label} hex`}
                  defaultValue={v.colors[f.key]}
                  key={v.colors[f.key]}
                  disabled={disabled}
                  onBlur={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value.trim()) && commit({ colors: { [f.key]: e.target.value.trim() } })}
                  style={{ ...input, fontFamily: "ui-monospace, monospace" }}
                />
              </div>
            </Field>
          ))}
        </section>

        <section style={group}>
          <h3 style={groupTitle}>Fonts</h3>
          <Field title="Headings">
            <select style={input} value={v.heading} disabled={disabled} onChange={(e) => commit({ heading: e.target.value })}>
              {THEME_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field title="Body text">
            <select style={input} value={v.body} disabled={disabled} onChange={(e) => commit({ body: e.target.value })}>
              {THEME_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section style={group}>
          <h3 style={groupTitle}>Corners</h3>
          <Field title="Cards, images and fields">
            <select style={input} value={v.radius} disabled={disabled} onChange={(e) => commit({ radius: e.target.value })}>
              {THEME_RADII.map((r) => (
                <option key={r} value={r}>
                  {RADIUS_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section style={{ ...group, borderBottom: 0 }}>
          <h3 style={groupTitle}>Buttons</h3>
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
                  style={{ flex: 1, border: `2px solid ${v.buttonStyle === s ? "#111" : "#d4d4d8"}`, background: "#fff", borderRadius: 6, padding: "6px 0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  {BUTTON_LABELS[s]}
                </button>
              ))}
            </div>
          </Field>
          <Field title="Button corners">
            <select style={input} value={v.buttonRadius} disabled={disabled} onChange={(e) => commit({ buttonRadius: e.target.value })}>
              <option value="">Same as other corners</option>
              {THEME_RADII.map((r) => (
                <option key={r} value={r}>
                  {RADIUS_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={v.uppercase} disabled={disabled} onChange={(e) => commit({ uppercase: e.target.checked })} />
            UPPERCASE button labels
          </label>
        </section>
      </aside>

      <div style={{ overflow: "auto", background: "#f4f4f5", padding: 16 }}>
        <div style={{ boxShadow: "0 1px 4px rgba(0,0,0,.15)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
          <BlocksPreview blocks={previewBlocks} host={host} themeVars={themeVars} storeName={storeName} />
        </div>
      </div>
    </div>
  );
}
