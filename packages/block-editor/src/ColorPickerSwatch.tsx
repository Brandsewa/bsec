import { useState, useRef, useEffect, useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_THEME_COLORS,
  GLOBAL_COLOR_DEFINITIONS,
  readableOn,
  resolveThemeColors,
  type ThemeTokensLike,
} from "@bs/blocks";
import { useThemeGlobalColors, type GlobalThemeColor } from "./context.tsx";
import { HexInput } from "./HexInput.tsx";

export interface ColorPickerSwatchProps {
  value?: string | undefined;
  onChange: (hex?: string | undefined) => void;
  label?: string | undefined;
  disabled?: boolean | undefined;
  showHexInput?: boolean | undefined;
  style?: CSSProperties | undefined;
  customPalette?: GlobalThemeColor[] | undefined;
  /** Optional companion text color (e.g. for background color picker) */
  textColor?: string | undefined;
  onTextColorChange?: ((hex?: string | undefined) => void) | undefined;
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
  textColor,
  onTextColorChange,
}: ColorPickerSwatchProps) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
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

  // Site Palette (Site Background, Primary, Secondary, Accent 1, Accent 2)
  const sitePalette = useMemo(() => {
    const site = globalColors.filter((c) => c.group === "site");
    const palette = globalColors.filter((c) => c.group === "palette");
    return [...site, ...palette];
  }, [globalColors]);

  // Text Color Scheme options (Heading, Body Text for Light and Dark modes)
  const textSchemeColors = useMemo(() => {
    const lightHeading = globalColors.find((c) => c.key === "lightHeading") || { key: "lightHeading", label: "Dark Heading", hex: "#0f172a", group: "light" as const };
    const lightText = globalColors.find((c) => c.key === "lightText") || { key: "lightText", label: "Dark Body", hex: "#334155", group: "light" as const };
    const darkHeading = globalColors.find((c) => c.key === "darkHeading") || { key: "darkHeading", label: "White Heading", hex: "#ffffff", group: "dark" as const };
    const darkText = globalColors.find((c) => c.key === "darkText") || { key: "darkText", label: "Light Body", hex: "#cbd5e1", group: "dark" as const };

    return [
      { key: "lightHeading", label: "Dark Heading", hex: lightHeading.hex, mode: "light" },
      { key: "lightText", label: "Dark Body", hex: lightText.hex, mode: "light" },
      { key: "darkHeading", label: "White Heading", hex: darkHeading.hex, mode: "dark" },
      { key: "darkText", label: "Light Body", hex: darkText.hex, mode: "dark" },
    ];
  }, [globalColors]);

  // Position calculation
  const updatePosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const popoverWidth = 260;
    let left = rect.right - popoverWidth;
    if (left < 10) left = 10;
    if (left + popoverWidth > window.innerWidth - 10) {
      left = window.innerWidth - popoverWidth - 10;
    }
    const top = rect.bottom + 6;
    setPopoverPos({ top, left });
  };

  const handleToggle = () => {
    if (disabled) return;
    if (!open) {
      updatePosition();
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  // Click outside & Escape key listeners
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    const handleScrollOrResize = () => {
      updatePosition();
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  const isValidHex = typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim());
  const hexValue = isValidHex ? value.trim() : "";
  const nativeColorValue = /^#[0-9a-f]{6}$/i.test(hexValue) ? hexValue : "#000000";

  // Check contrast for text color suggestions
  const isBgDark = value ? readableOn(value) === "#ffffff" : false;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        ...style,
      }}
    >
      {/* Circle swatch button */}
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${value || "transparent"}`}
        aria-expanded={open}
        onClick={handleToggle}
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

      {/* Optional Hex text input beside swatch (used if explicitly requested) */}
      {showHexInput ? (
        <HexInput
          ariaLabel={`${label} hex code`}
          value={value}
          disabled={disabled}
          onCommit={onChange}
          onClear={() => onChange(undefined)}
          style={{
            flex: 1,
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

      {/* Popover rendered via Portal to document.body (always on top of any accordion/panel) */}
      {open && popoverPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Color Picker"
              style={{
                position: "fixed",
                top: popoverPos.top,
                left: popoverPos.left,
                zIndex: 999999,
                width: 260,
                background: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: 10,
                boxShadow: "0 10px 25px -5px rgba(0,0,0,0.22), 0 8px 10px -6px rgba(0,0,0,0.14)",
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

              {/* 1. Site Palette (Single row of 5 curated colors) */}
              <div>
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
                  Site Palette
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                  {sitePalette.map((gc) => {
                    const isSelected = value?.toLowerCase() === gc.hex.toLowerCase();
                    return (
                      <button
                        key={gc.key}
                        type="button"
                        title={`${gc.label} (${gc.hex})`}
                        onClick={() => {
                          onChange(gc.hex);
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

              {/* 2. Text Color Scheme Options (Allows selecting or pairing text colors) */}
              <div style={{ borderTop: "1px dashed #e4e4e7", paddingTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#71717a",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Text Color Scheme
                  </span>
                  {textColor && onTextColorChange ? (
                    <button
                      type="button"
                      onClick={() => onTextColorChange(undefined)}
                      style={{
                        border: 0,
                        background: "none",
                        fontSize: 10,
                        color: "#71717a",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Default
                    </button>
                  ) : null}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {textSchemeColors.map((tc) => {
                    const activeColorTarget = onTextColorChange ? textColor : value;
                    const isSelected = activeColorTarget?.toLowerCase() === tc.hex.toLowerCase();
                    const isRecommended = isBgDark ? tc.mode === "dark" : tc.mode === "light";

                    return (
                      <button
                        key={tc.key}
                        type="button"
                        title={`${tc.label} (${tc.hex})${isRecommended ? " — Suggested" : ""}`}
                        onClick={() => {
                          if (onTextColorChange) {
                            onTextColorChange(tc.hex);
                          } else {
                            onChange(tc.hex);
                          }
                        }}
                        style={{
                          display: "grid",
                          justifyItems: "center",
                          gap: 3,
                          padding: "4px 2px",
                          border: isSelected ? "1px solid #2563eb" : isRecommended ? "1px solid #bfdbfe" : "1px solid #e4e4e7",
                          background: isSelected ? "#eff6ff" : isRecommended ? "#f8fafc" : "#ffffff",
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: tc.hex,
                            border: "1px solid rgba(0,0,0,0.18)",
                            boxShadow: "inset 0 0 0 1px #fff",
                            display: "inline-block",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: isSelected ? 700 : 500,
                            color: isSelected ? "#1d4ed8" : "#52525b",
                            lineHeight: 1.1,
                            textAlign: "center",
                          }}
                        >
                          {tc.label.split(" ")[0]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3. Custom Color Section */}
              <div style={{ borderTop: "1px dashed #e4e4e7", paddingTop: 8 }}>
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
                  <HexInput
                    ariaLabel={`${label} hex code`}
                    value={value}
                    onCommit={onChange}
                    onClear={() => onChange(undefined)}
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
            </div>,
            document.body
          )
        : null}
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
