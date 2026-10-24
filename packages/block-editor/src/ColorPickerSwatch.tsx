import { useState, useRef, useEffect, type CSSProperties, useMemo } from "react";
import {
  DEFAULT_THEME_COLORS,
  GLOBAL_COLOR_DEFINITIONS,
  readableOn,
  resolveThemeColors,
  type ThemeTokensLike,
} from "@bs/blocks";
import { useThemeGlobalColors, type GlobalThemeColor } from "./context.tsx";

export interface ColorPickerSwatchProps {
  value?: string | undefined;
  onChange: (hex?: string | undefined) => void;
  label?: string | undefined;
  disabled?: boolean | undefined;
  showHexInput?: boolean | undefined;
  style?: CSSProperties | undefined;
  customPalette?: GlobalThemeColor[] | undefined;
}

const CHECKERBOARD = "repeating-conic-gradient(#e4e4e7 0 25%, #fff 0 50%) 50% / 8px 8px";

export function ColorPickerSwatch({
  value,
  onChange,
  label = "Color",
  disabled,
  showHexInput = false,
  style,
  customPalette,
}: ColorPickerSwatchProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contextColors = useThemeGlobalColors();

  // Fallback palette from defaults if not provided in context
  const fallbackColors = useMemo<GlobalThemeColor[]>(() => {
    const resolved = resolveThemeColors(null);
    return GLOBAL_COLOR_DEFINITIONS.map((def) => ({
      key: def.key,
      label: def.label,
      group: def.group,
      hex: resolved[def.key] ?? DEFAULT_THEME_COLORS[def.key],
    }));
  }, []);

  const globalColors = customPalette ?? (contextColors.length > 0 ? contextColors : fallbackColors);

  // Group global colors for categorized display
  const paletteGroups = useMemo(() => {
    const site = globalColors.filter((c) => c.group === "site");
    const palette = globalColors.filter((c) => c.group === "palette");
    const light = globalColors.filter((c) => c.group === "light");
    const dark = globalColors.filter((c) => c.group === "dark");
    return [
      { name: "Site & Palette", items: [...site, ...palette] },
      { name: "Light Scheme", items: light },
      { name: "Dark Scheme", items: dark },
    ];
  }, [globalColors]);

  // Click outside listener
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const isValidHex = typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim());
  const hexValue = isValidHex ? value.trim() : "";
  const nativeColorValue = /^#[0-9a-f]{6}$/i.test(hexValue) ? hexValue : "#000000";

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      {/* Circle swatch button */}
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${value || "transparent"}`}
        aria-expanded={open}
        onClick={() => !disabled && setOpen(!open)}
        style={{
          width: 24,
          height: 24,
          flex: "none",
          borderRadius: "50%",
          background: value || CHECKERBOARD,
          border: "1px solid rgba(0,0,0,0.18)",
          boxShadow: "inset 0 0 0 2px #fff",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 0,
          position: "relative",
          outline: open ? "2px solid #2563eb" : "none",
          outlineOffset: 1,
          transition: "transform 0.1s ease, box-shadow 0.1s ease",
        }}
      />

      {/* Optional Hex text input beside swatch (used in ThemeSettings) */}
      {showHexInput ? (
        <input
          type="text"
          aria-label={`${label} hex code`}
          value={value ?? ""}
          placeholder="#000000"
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const trimmed = e.target.value.trim();
            if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
              onChange(trimmed);
            } else if (trimmed === "") {
              onChange(undefined);
            }
          }}
          style={{
            width: "100%",
            border: "1px solid #d4d4d8",
            borderRadius: 7,
            padding: "4px 8px",
            fontSize: 12,
            background: "#fff",
            color: "#111",
            fontFamily: "ui-monospace, monospace",
          }}
        />
      ) : null}

      {/* Popover */}
      {open ? (
        <div
          role="dialog"
          aria-label="Color Picker"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 99999,
            width: 260,
            background: "#ffffff",
            border: "1px solid #e4e4e7",
            borderRadius: 10,
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.14), 0 8px 10px -6px rgba(0,0,0,0.08)",
            padding: 12,
            display: "grid",
            gap: 12,
            animation: "bricks-pop-in 0.12s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#18181b" }}>{label}</span>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
                style={{
                  border: 0,
                  background: "none",
                  color: "#dc2626",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "0 2px",
                }}
              >
                Clear
              </button>
            ) : null}
          </div>

          {/* Global Colors Sections */}
          <div style={{ display: "grid", gap: 10 }}>
            {paletteGroups.map((group) => (
              <div key={group.name}>
                <span
                  style={{
                    display: "block",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#71717a",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: 5,
                  }}
                >
                  {group.name}
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                  {group.items.map((gc) => {
                    const isSelected = value?.toLowerCase() === gc.hex.toLowerCase();
                    return (
                      <button
                        key={gc.key}
                        type="button"
                        title={`${gc.label} (${gc.hex})`}
                        onClick={() => {
                          onChange(gc.hex);
                          setOpen(false);
                        }}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          border: isSelected ? "2px solid #2563eb" : "1px solid rgba(0,0,0,0.18)",
                          boxShadow: isSelected ? "0 0 0 2px rgba(37,99,235,0.35), inset 0 0 0 2px #fff" : "inset 0 0 0 2px #fff",
                          background: gc.hex,
                          cursor: "pointer",
                          padding: 0,
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "transform 0.1s ease",
                        }}
                      >
                        {isSelected ? (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: readableOn(gc.hex),
                            }}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Custom Color Section */}
          <div style={{ borderTop: "1px solid #f4f4f5", paddingTop: 8 }}>
            <span
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 700,
                color: "#71717a",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              Custom Color
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Native picker concealed under round swatch */}
              <label
                style={{
                  position: "relative",
                  width: 28,
                  height: 28,
                  flex: "none",
                  borderRadius: "50%",
                  background: hexValue || CHECKERBOARD,
                  border: "1px solid rgba(0,0,0,0.18)",
                  boxShadow: "inset 0 0 0 2px #fff",
                  overflow: "hidden",
                  cursor: "pointer",
                }}
              >
                <input
                  type="color"
                  value={nativeColorValue}
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

              {/* Hex Text Input */}
              <input
                type="text"
                value={value ?? ""}
                placeholder="#000000"
                onChange={(e) => onChange(e.target.value)}
                onBlur={(e) => {
                  const trimmed = e.target.value.trim();
                  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
                    onChange(trimmed);
                  } else if (trimmed === "") {
                    onChange(undefined);
                  }
                }}
                style={{
                  flex: 1,
                  border: "1px solid #d4d4d8",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 12,
                  fontFamily: "ui-monospace, monospace",
                  background: "#fafafa",
                  color: "#18181b",
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Helper to extract GlobalThemeColor array from theme tokens or resolved theme vars */
export function extractGlobalColors(
  tokens?: ThemeTokensLike | null,
  themeVars?: Record<string, string> | null,
): GlobalThemeColor[] {
  const resolved = resolveThemeColors(null, tokens);
  return GLOBAL_COLOR_DEFINITIONS.map((def) => ({
    key: def.key,
    label: def.label,
    group: def.group,
    hex: resolved[def.key] ?? (themeVars?.[`--bs-${def.key}`] || DEFAULT_THEME_COLORS[def.key]),
  }));
}
