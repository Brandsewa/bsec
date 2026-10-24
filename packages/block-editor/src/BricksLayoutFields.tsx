import { useState } from "react";
import type { CustomField, Field } from "@puckeditor/core";
import { AutoField, FieldLabel, usePuck } from "@puckeditor/core";
import { useHost, useRenderData } from "./context.tsx";
import {
  BricksTabsHeader,
  BricksGroupHeader,
  BricksFieldGate,
  BRICKS_TAB_HEADER_KEY,
  BRICKS_GROUP_PREFIX,
  useBricksActiveDevice,
} from "./BricksTabs.tsx";
import { ColorPickerSwatch } from "./ColorPickerSwatch.tsx";

// =============================================================================
// BRICKS BUILDER ORIGINAL SVG ICONS
// =============================================================================

export const BricksIcons = {
  // Tabs
  content: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  style: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <g transform="rotate(45 12 12)">
        <path d="M7 11h1c2 0 2.5-2 2.5-4L10 4c-.3-1.5.5-2.5 2-2.5s2.3 1 2 2.5l-.5 3c0 2 .5 4 2.5 4h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" />
        <path d="M6 14h12" />
      </g>
    </svg>
  ),

  // Style Groups
  layout: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 3v18c0 .8.7 1.5 1.5 1.5h18c.8 0 1.5-.7 1.5-1.5V3c0-.8-.7-1.5-1.5-1.5H3c-.8 0-1.5.7-1.5 1.5Z" />
      <path d="M12 22.5V1.5" />
      <path d="M12 12h10" />
    </svg>
  ),
  background: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16.5c0-.3.1-.7.2-1 .1-.3.4-.6.6-.8.4-.4.8-.8 1-1.3.3-.5.4-1.1.4-1.6 0-.5-.1-1-.3-1.4-.2-.4-.5-.8-.9-1.1-.3-.2-.6-.5-.7-.9-.2-.3-.2-.7-.2-1.1 0-.4.1-.8.4-1.1.2-.3.5-.6.8-.8.3-.2.6-.4.8-.7.2-.3.3-.7.3-1 0-.8-.3-1.6-.9-2.1C21.8 1.1 21 0.8 20.2 0.8c-.4 0-.7.1-1 .3-.3.2-.6.5-.7.8-.2.3-.4.6-.7.8-.3.2-.7.3-1 .4-.4 0-.7 0-1.1-.2-.3-.1-.6-.4-.9-.7-.4-.4-.8-.8-1.3-1-.5-.2-1.1-.4-1.6-.4-.5 0-1 .1-1.4.3-.4.2-.8.5-1.1.9-.2.3-.5.6-.9.7-.3.2-.7.2-1.1.2-.4 0-.8-.1-1.1-.4-.3-.2-.6-.5-.8-.8-.2-.3-.4-.6-.7-.8-.3-.2-.7-.3-1-.3-.8 0-1.6.3-2.1.9C1.1 2.2 0.8 3 0.8 3.8c0 .4.1.7.3 1 .2.3.5.6.8.7.3.2.6.4.8.7.2.3.3.7.4 1 0 .4 0 .8-.2 1.1-.1.3-.4.6-.7.9-.4.4-.8.8-1 1.3-.2.5-.4 1.1-.4 1.6 0 .5.1 1 .3 1.4.2.4.5.8.9 1.1.3.2.6.5.7.9.2.3.2.7.2 1.1 0 .4-.1.8-.4 1.1-.2.3-.5.6-.8.8-.3.2-.6.4-.8.7-.2.3-.3.7-.3 1 0 .8.3 1.6.9 2.1.6.6 1.3.9 2.1.9.4 0 .7-.1 1-.3.3-.2.6-.5.7-.8.2-.3.4-.6.7-.8.3-.2.7-.3 1-.4.4 0 .7 0 1.1.2.3.1.6.4.9.7.4.4.8.8 1.3 1 .5.2 1.1.4 1.6.4.5 0 1-.1 1.4-.3.4-.2.8-.5 1.1-.9.2-.3.5-.6.9-.7.3-.2.7-.2 1.1-.2.4 0 .8.1 1.1.4.3.2.6.5.8.8.2.3.4.6.7.8.3.2.7.3 1 .3.8 0 1.6-.3 2.1-.9.6-.6.9-1.3.9-2.1 0-.4-.1-.7-.3-1-.2-.3-.5-.6-.8-.7-.4-.2-.7-.5-.9-.8-.2-.3-.3-.7-.3-1.1Z" />
      <path d="M6.8 6.8h10.5v10.5H6.8V6.8Z" />
    </svg>
  ),
  border: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0.8 8.2v-6c0-.4.2-.8.4-1 .3-.3.7-.4 1.1-.4h6" />
      <path d="M23.2 8.2v-6c0-.4-.2-.8-.4-1-.3-.3-.7-.4-1.1-.4h-6" />
      <path d="M0.8 15.7v6c0 .4.2.8.4 1 .3.3.7.4 1.1.4h6" />
      <path d="M23.2 15.7v6c0 .4-.2.8-.4 1s-.7.4-1.1.4h-6" />
      <path d="M5.2 5.2h13.5v13.5H5.2V5.2Z" />
    </svg>
  ),
  typography: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  ),
  link: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  unlink: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M5.16 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ),

  // Display Icons
  displayFlex: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.5,2h-4c-0.3,0 -0.5,0.2 -0.5,0.5v19c0,0.3 0.2,0.5 0.5,0.5h4c0.3,0 0.5,-0.2 0.5,-0.5v-19c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
      <path d="M23.5,2h-4c-0.3,0 -0.5,0.2 -0.5,0.5v19c0,0.3 0.2,0.5 0.5,0.5h4c0.3,0 0.5,-0.2 0.5,-0.5v-19c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
      <path d="M17.5,2h-11c-0.3,0 -0.5,0.2 -0.5,0.5v19c0,0.3 0.2,0.5 0.5,0.5h11c0.3,0 0.5,-0.2 0.5,-0.5v-19c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
    </svg>
  ),
  displayBlock: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5,1h-23c-0.3,0 -0.5,0.2 -0.5,0.5v9c0,0.3 0.2,0.5 0.5,0.5h23c0.3,0 0.5,-0.2 0.5,-0.5v-9c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
      <path d="M23.5,13h-23c-0.3,0 -0.5,0.2 -0.5,0.5v9c0,0.3 0.2,0.5 0.5,0.5h23c0.3,0 0.5,-0.2 0.5,-0.5v-9c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
    </svg>
  ),
  displayGrid: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.5,0h-10c-0.3,0 -0.5,0.2 -0.5,0.5v10c0,0.3 0.2,0.5 0.5,0.5h10c0.3,0 0.5,-0.2 0.5,-0.5v-10c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
      <path d="M23.5,0h-10c-0.3,0 -0.5,0.2 -0.5,0.5v10c0,0.3 0.2,0.5 0.5,0.5h10c0.3,0 0.5,-0.2 0.5,-0.5v-10c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
      <path d="M10.5,13h-10c-0.3,0 -0.5,0.2 -0.5,0.5v10c0,0.3 0.2,0.5 0.5,0.5h10c0.3,0 0.5,-0.2 0.5,-0.5v-10c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
      <path d="M23.5,13h-10c-0.3,0 -0.5,0.2 -0.5,0.5v10c0,0.3 0.2,0.5 0.5,0.5h10c0.3,0 0.5,-0.2 0.5,-0.5v-10c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
    </svg>
  ),
  displayInline: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.5,5h-4c-0.3,0 -0.5,0.2 -0.5,0.5v13c0,0.2 0.5,0.5 0.5,0.5h4c0.3,0 0.5,-0.2 0.5,-0.5v-13c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
      <path d="M23.5,5h-4c-0.3,0 -0.5,0.2 -0.5,0.5v13c0,0.2 0.5,0.5 0.5,0.5h4c0.3,0 0.5,-0.2 0.5,-0.5v-13c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
      <path d="M17.5,1h-11c-0.3,0 -0.5,0.2 -0.5,0.5v21c0,0.3 0.2,0.5 0.5,0.5h11c0.3,0 0.5,-0.2 0.5,-0.5v-21c0,-0.3 -0.2,-0.5 -0.5,-0.5Z" />
    </svg>
  ),
  displayNone: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5.8 6.3C7.4 4.5 9.2 3.4 12 3.4c5.3 0 7 3.8 10.3 8.6-1.7 2.5-3 4.7-4.6 6.2" />
      <path d="M15.8 19.7c-1.1.6-2.3.9-3.8.9-5.3 0-7-3.8-10.3-8.6 1-1.4 1.8-2.7 2.6-3.8" />
      <line x1="1.2" y1="1.2" x2="22.8" y2="22.8" />
    </svg>
  ),

  // Direction Icons
  dirRow: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M86 16H112V112H86zM51 16H77V112H51zM16 16H42V112H16z" />
    </svg>
  ),
  dirColumn: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M16 86H112V112H16zM16 51H112V77H16zM16 16H112V42H16z" />
    </svg>
  ),

  // Align Main Axis (Justify Content)
  justifyStart: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M0 0H128V8H0zM16 16H112V48H16zM16 56H112V88H16z" />
    </svg>
  ),
  justifyCenter: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M0 60H128V68H0zM16 20H112V52H16zM16 76H112V108H16z" />
    </svg>
  ),
  justifyEnd: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M0 120H128V128H0zM16 80H112V112H16zM16 40H112V72H16z" />
    </svg>
  ),
  justifyBetween: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M0 120H128V128H0zM0 0H128V8H0zM16 12H112V44H16zM16 84H112V116H16z" />
    </svg>
  ),
  justifyAround: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M0 120H128V128H0zM0 0H128V8H0zM16 20H112V52H16zM16 76H112V108H16z" />
    </svg>
  ),
  justifyEvenly: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M0 120H128V128H0zM0 0H128V8H0zM16 24H112V56H16zM16 72H112V104H16z" />
    </svg>
  ),

  // Align Cross Axis (Align Items)
  alignStart: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M0 0H8V128H0zM16 16H80V64H16zM16 72H100V120H16z" />
    </svg>
  ),
  alignCenter: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M60 0H68V24H60zM60 104H68V128H60zM16 28H112V60H16zM16 68H112V100H16z" />
    </svg>
  ),
  alignEnd: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M120 0H128V128H120zM48 16H112V64H48zM28 72H112V120H28z" />
    </svg>
  ),
  alignStretch: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M120 0H128V128H120zM0 0H8V128H0zM16 28H112V60H16zM16 68H112V100H16z" />
    </svg>
  ),
  alignBaseline: (
    <svg width="15" height="15" viewBox="0 0 128 128" fill="currentColor">
      <path d="M60 0H68V128H60zM68 28H96V60H68zM68 68H112V100H68z" />
    </svg>
  ),
  alignAuto: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <rect x="0" y="0" width="1.5" height="24" />
      <rect x="22.5" y="0" width="1.5" height="24" />
      <text x="12" y="15" fontSize="16" fontWeight="bold" textAnchor="middle">A</text>
    </svg>
  ),
};

// =============================================================================
// SEGMENTED ICON CONTROL FACTORY
// =============================================================================

export function bricksSegmentedField<T extends string>(
  label: string,
  options: { value: T; label?: string; icon?: React.ReactNode; tooltip?: string }[]
): CustomField<T | undefined> {
  return {
    type: "custom",
    label,
    render: ({ value, onChange }) => (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 34 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "#18181b" }}>{label}</span>
        <div style={{ display: "inline-flex", background: "#f0f0f3", borderRadius: 6, padding: 2, gap: 2 }}>
          {options.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                title={opt.tooltip || opt.label || opt.value}
                onClick={() => onChange(isSelected ? undefined : opt.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 26,
                  minWidth: 26,
                  padding: "0 6px",
                  borderRadius: 4,
                  border: 0,
                  background: isSelected ? "#18181b" : "transparent",
                  color: isSelected ? "#ffffff" : "#52525b",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                }}
              >
                {opt.icon ? opt.icon : opt.label || opt.value}
              </button>
            );
          })}
        </div>
      </div>
    ),
  };
}

// Spacing Quad Control Component
function QuadControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Record<string, string> | undefined;
  onChange: (v: Record<string, string> | undefined) => void;
}) {
  const activeDevice = useBricksActiveDevice();
  const puck = usePuck();
  const fieldKey = label.toLowerCase();
  const desktopQuad = ((puck?.selectedItem?.props as Record<string, unknown>)?.[fieldKey] as Record<string, string>) || {};

  const v: Record<string, string | undefined> = value || {};
  const set = (k: string, val: string) => {
    const trimmed = val.trim();
    const normalized = /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
    const next: Record<string, string | undefined> = { ...v, [k]: normalized || undefined };
    if (Object.values(next).every((x) => !x)) onChange(undefined);
    else onChange(next as Record<string, string>);
  };

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#18181b" }}>{label}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
        {["top", "right", "bottom", "left"].map((k) => {
          const inherited = activeDevice !== "desktop" ? desktopQuad[k] : undefined;
          return (
            <div key={k} style={{ display: "grid", gap: 2, textAlign: "center" }}>
              <input
                placeholder={inherited || "-"}
                value={v[k] || ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const next: Record<string, string | undefined> = { ...v, [k]: raw || undefined };
                  if (Object.values(next).every((x) => !x)) onChange(undefined);
                  else onChange(next as Record<string, string>);
                }}
                onBlur={(e) => set(k, e.target.value)}
                style={{ width: "100%", padding: "4px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, textAlign: "center", boxSizing: "border-box" }}
              />
              <span style={{ fontSize: 9, color: "#71717a", textTransform: "uppercase" }}>{k}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const quadField = (label: string): CustomField<Record<string, string> | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <QuadControl label={label} value={value} onChange={onChange} />,
});

// Sizing Panel Component
function SizingControl({
  value,
  onChange,
}: {
  value: Record<string, string> | undefined;
  onChange: (v: Record<string, string> | undefined) => void;
}) {
  const activeDevice = useBricksActiveDevice();
  const puck = usePuck();
  const desktopSizing = ((puck?.selectedItem?.props as Record<string, unknown>)?.sizing as Record<string, string>) || {};

  const v: Record<string, string | undefined> = value || {};
  const set = (k: string, val: string) => {
    const trimmed = val.trim();
    const normalized = k !== "aspectRatio" && /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
    const next: Record<string, string | undefined> = { ...v, [k]: normalized || undefined };
    if (Object.values(next).every((x) => !x)) onChange(undefined);
    else onChange(next as Record<string, string>);
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {[
        { key: "width", label: "Width" },
        { key: "minWidth", label: "Min. width" },
        { key: "maxWidth", label: "Max. width" },
        { key: "height", label: "Height" },
        { key: "minHeight", label: "Min. height" },
        { key: "maxHeight", label: "Max. height" },
        { key: "aspectRatio", label: "Aspect ratio" },
      ].map(({ key, label }) => {
        const rawVal = v[key];
        const inherited = activeDevice !== "desktop" ? desktopSizing[key] : undefined;
        const ph = inherited ? `${inherited} (inherit)` : "auto";
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#27272a" }}>{label}</span>
            <input
              placeholder={ph}
              value={rawVal || ""}
              onChange={(e) => {
                const raw = e.target.value;
                const next: Record<string, string | undefined> = { ...v, [key]: raw || undefined };
                if (Object.values(next).every((x) => !x)) onChange(undefined);
                else onChange(next as Record<string, string>);
              }}
              onBlur={(e) => set(key, e.target.value)}
              style={{ width: 110, padding: "4px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, textAlign: "right" }}
            />
          </div>
        );
      })}
    </div>
  );
}

export const sizingField = (): CustomField<Record<string, string> | undefined> => ({
  type: "custom",
  label: "Sizing",
  render: ({ value, onChange }) => <SizingControl value={value} onChange={onChange} />,
});

function BackgroundControl({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown> | undefined) => void;
}) {
  const host = useHost();
  const { media } = useRenderData();
  const v = (value as Record<string, unknown> | undefined) || {};
  const set = (k: string, val: unknown) => {
    const next = { ...v, [k]: val !== undefined && val !== "" ? val : undefined };
    if (Object.values(next).every((x) => x === undefined)) onChange(undefined);
    else onChange(next);
  };

  const chooseMedia = async (kind: "image" | "video") => {
    if (!host?.pickMedia) return;
    try {
      const assets = await host.pickMedia({
        accept: [kind],
        multiple: false,
        selected: kind === "image" && v.mediaId ? [v.mediaId as string] : [],
      });
      if (assets && assets[0]) {
        if (kind === "image") {
          set("mediaId", assets[0].id);
          set("imageUrl", assets[0].url);
        } else {
          set("videoUrl", assets[0].url);
        }
      }
    } catch (e) {
      console.error("Media selection failed:", e);
    }
  };

  const activeImageSrc = (v.imageUrl as string) || (v.mediaId ? media[v.mediaId as string] : null);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* Background Color */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>Color</span>
        <ColorPickerSwatch
          label="Background Color"
          value={v.color as string | undefined}
          onChange={(hex) => set("color", hex)}
          textColor={v.textColor as string | undefined}
          onTextColorChange={(hex) => set("textColor", hex)}
        />
      </div>

      {/* Text Color */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>Text Color</span>
        <ColorPickerSwatch
          label="Text Color"
          value={v.textColor as string | undefined}
          onChange={(hex) => set("textColor", hex)}
        />
      </div>

      {/* Background Image with Media Library Button */}
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>Image</span>
          {host?.pickMedia ? (
            <button
              type="button"
              onClick={() => chooseMedia("image")}
              style={{
                border: "1px solid #e4e4e7",
                background: "#ffffff",
                borderRadius: 5,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 500,
                color: "#18181b",
                cursor: "pointer",
              }}
            >
              Media Library
            </button>
          ) : null}
        </div>

        {activeImageSrc ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 4, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fafafa" }}>
            <img src={activeImageSrc} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: "#71717a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {v.mediaId ? `ID: ${v.mediaId}` : activeImageSrc}
            </div>
            <button
              type="button"
              onClick={() => {
                set("mediaId", undefined);
                set("imageUrl", undefined);
              }}
              style={{ border: 0, background: "none", color: "#dc2626", fontSize: 11, cursor: "pointer" }}
            >
              Remove
            </button>
          </div>
        ) : (
          <input
            placeholder="Or enter Image URL (https://...)"
            value={(v.imageUrl as string) || ""}
            onChange={(e) => set("imageUrl", e.target.value)}
            style={{ width: "100%", padding: "4px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, boxSizing: "border-box" }}
          />
        )}
      </div>

      {activeImageSrc ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <label style={{ display: "grid", gap: 2, fontSize: 11, color: "#52525b" }}>
            Layout / Fit
            <select
              value={(v.imageSize as string) || "cover"}
              onChange={(e) => set("imageSize", e.target.value)}
              style={{ padding: "4px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff" }}
            >
              <option value="cover">Cover (Fill & Crop)</option>
              <option value="contain">Contain (Fit inside)</option>
              <option value="fill">Fill (Stretch)</option>
              <option value="scale-down">Scale Down</option>
              <option value="none">None (Original)</option>
              <option value="auto">Auto</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 2, fontSize: 11, color: "#52525b" }}>
            Alignment / Focus
            <select
              value={(v.imagePosition as string) || "center center"}
              onChange={(e) => set("imagePosition", e.target.value)}
              style={{ padding: "4px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff" }}
            >
              <option value="center center">Center</option>
              <option value="top center">Top Center</option>
              <option value="bottom center">Bottom Center</option>
              <option value="center left">Center Left</option>
              <option value="center right">Center Right</option>
              <option value="top left">Top Left</option>
              <option value="top right">Top Right</option>
              <option value="bottom left">Bottom Left</option>
              <option value="bottom right">Bottom Right</option>
            </select>
          </label>
        </div>
      ) : null}

      {/* Background Video */}
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>Video</span>
          {host?.pickMedia ? (
            <button
              type="button"
              onClick={() => chooseMedia("video")}
              style={{
                border: "1px solid #e4e4e7",
                background: "#ffffff",
                borderRadius: 5,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 500,
                color: "#18181b",
                cursor: "pointer",
              }}
            >
              Media Library
            </button>
          ) : null}
        </div>
        <input
          placeholder="Video URL (MP4 / WebM)"
          value={(v.videoUrl as string) || ""}
          onChange={(e) => set("videoUrl", e.target.value)}
          style={{ width: "100%", padding: "4px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, boxSizing: "border-box" }}
        />
        {v.videoUrl ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
            <label style={{ display: "grid", gap: 2, fontSize: 11, color: "#52525b" }}>
              Video Fit
              <select
                value={(v.videoFit as string) || "cover"}
                onChange={(e) => set("videoFit", e.target.value)}
                style={{ padding: "4px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff" }}
              >
                <option value="cover">Cover (Fill & Crop)</option>
                <option value="contain">Contain (Fit inside)</option>
                <option value="fill">Fill (Stretch)</option>
                <option value="scale-down">Scale Down</option>
                <option value="none">None</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 2, fontSize: 11, color: "#52525b" }}>
              Alignment / Focus
              <select
                value={(v.videoPosition as string) || "center center"}
                onChange={(e) => set("videoPosition", e.target.value)}
                style={{ padding: "4px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff" }}
              >
                <option value="center center">Center</option>
                <option value="top center">Top Center</option>
                <option value="bottom center">Bottom Center</option>
                <option value="center left">Center Left</option>
                <option value="center right">Center Right</option>
                <option value="top left">Top Left</option>
                <option value="top right">Top Right</option>
                <option value="bottom left">Bottom Left</option>
                <option value="bottom right">Bottom Right</option>
              </select>
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Background Panel with Media Library Picker
export const backgroundField = (): CustomField<Record<string, unknown> | undefined> => ({
  type: "custom",
  label: "Background",
  render: ({ value, onChange }) => <BackgroundControl value={value} onChange={onChange} />,
});

function BorderControl({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown> | undefined) => void;
}) {
  const activeDevice = useBricksActiveDevice();
  const puck = usePuck();
  const v = (value as Record<string, unknown> | undefined) || {};

  const selectedProps = puck?.selectedItem?.props as Record<string, unknown> | undefined;
  const desktopBorder = (selectedProps?.border as Record<string, unknown>) || {};
  const desktopRc = (desktopBorder.radiusCorners as Record<string, string>) || {};
  const desktopRadius = (desktopBorder.radius as string) || "";
  const desktopWidth = (desktopBorder.width as string) || "";

  const normalizeValue = (raw: string | undefined): string => {
    if (!raw) return "";
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}px`;
    return trimmed;
  };

  const rc = ((v.radiusCorners as Record<string, string>) || {});

  // Initial linked state: true if no individual corners or if all 4 corners are identical
  const [isLinked, setIsLinked] = useState(() => {
    if (v.radiusCorners) {
      const vals = Object.values(v.radiusCorners as Record<string, string>).filter(Boolean);
      if (vals.length > 1) {
        const first = vals[0];
        return vals.every((x) => x === first);
      }
    }
    return true;
  });

  const set = (k: string, val: unknown) => {
    const next = { ...v, [k]: val !== undefined && val !== "" ? val : undefined };
    if (Object.values(next).every((x) => x === undefined)) onChange(undefined);
    else onChange(next);
  };

  const handleLinkedRadiusChange = (raw: string) => {
    if (!raw) {
      const next = { ...v, radius: undefined, radiusCorners: undefined };
      if (Object.values(next).every((x) => x === undefined)) onChange(undefined);
      else onChange(next);
    } else {
      const next = {
        ...v,
        radius: raw,
        radiusCorners: { topLeft: raw, topRight: raw, bottomRight: raw, bottomLeft: raw },
      };
      onChange(next);
    }
  };

  const handleLinkedRadiusBlur = (raw: string) => {
    const normalized = normalizeValue(raw);
    if (!normalized) {
      const next = { ...v, radius: undefined, radiusCorners: undefined };
      if (Object.values(next).every((x) => x === undefined)) onChange(undefined);
      else onChange(next);
    } else {
      const next = {
        ...v,
        radius: normalized,
        radiusCorners: { topLeft: normalized, topRight: normalized, bottomRight: normalized, bottomLeft: normalized },
      };
      onChange(next);
    }
  };

  const setCorner = (corner: string, val: string) => {
    const nextCorners = { ...rc, [corner]: val || undefined };
    if (Object.values(nextCorners).every((x) => !x)) {
      const next = { ...v, radius: undefined, radiusCorners: undefined };
      if (Object.values(next).every((x) => x === undefined)) onChange(undefined);
      else onChange(next);
    } else {
      const next = { ...v, radius: undefined, radiusCorners: nextCorners };
      onChange(next);
    }
  };

  const setCornerBlur = (corner: string, val: string) => {
    const normalized = normalizeValue(val);
    const nextCorners = { ...rc, [corner]: normalized || undefined };
    if (Object.values(nextCorners).every((x) => !x)) {
      const next = { ...v, radius: undefined, radiusCorners: undefined };
      if (Object.values(next).every((x) => x === undefined)) onChange(undefined);
      else onChange(next);
    } else {
      const next = { ...v, radius: undefined, radiusCorners: nextCorners };
      onChange(next);
    }
  };

  const cornersList = [
    { key: "topLeft", label: "TL" },
    { key: "topRight", label: "TR" },
    { key: "bottomRight", label: "BR" },
    { key: "bottomLeft", label: "BL" },
  ] as const;

  const currentLinkedValue = (v.radius as string) || rc.topLeft || "";
  const inheritedLinkedValue = activeDevice !== "desktop" ? (desktopRadius || desktopRc.topLeft || "") : "";

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>Width</span>
        <input
          placeholder={activeDevice !== "desktop" && desktopWidth ? `${desktopWidth} (inherit)` : "1px"}
          value={(v.width as string) || ""}
          onChange={(e) => set("width", e.target.value)}
          onBlur={(e) => set("width", normalizeValue(e.target.value))}
          style={{ width: 80, padding: "4px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, textAlign: "right" }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>Style</span>
        <select
          value={(v.style as string) || "solid"}
          onChange={(e) => set("style", e.target.value)}
          style={{ padding: "4px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff" }}
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          <option value="double">Double</option>
        </select>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>Color</span>
        <ColorPickerSwatch
          label="Border Color"
          value={v.color as string | undefined}
          onChange={(hex) => set("color", hex)}
        />
      </div>

      {/* Border Radius Header with Link / Unlink toggle */}
      <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>Border Radius</span>
          <button
            type="button"
            onClick={() => {
              if (!isLinked) {
                const syncVal = rc.topLeft || rc.topRight || rc.bottomRight || rc.bottomLeft || (v.radius as string) || "";
                if (syncVal) {
                  set("radius", syncVal);
                  set("radiusCorners", { topLeft: syncVal, topRight: syncVal, bottomRight: syncVal, bottomLeft: syncVal });
                }
                setIsLinked(true);
              } else {
                const currVal = (v.radius as string) || rc.topLeft || "";
                if (currVal) {
                  set("radiusCorners", { topLeft: currVal, topRight: currVal, bottomRight: currVal, bottomLeft: currVal });
                }
                setIsLinked(false);
              }
            }}
            title={isLinked ? "Unlink corners (edit TL, TR, BR, BL individually)" : "Link corners (apply same radius to all)"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              fontSize: 10,
              border: "1px solid #e4e4e7",
              borderRadius: 4,
              background: isLinked ? "#f4f4f5" : "#e0e7ff",
              color: isLinked ? "#52525b" : "#4338ca",
              cursor: "pointer",
            }}
          >
            {isLinked ? BricksIcons.link : BricksIcons.unlink}
            <span>{isLinked ? "Linked" : "Separate"}</span>
          </button>
        </div>

        {isLinked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              placeholder={inheritedLinkedValue ? `${inheritedLinkedValue} (inherit)` : "0px"}
              value={currentLinkedValue}
              onChange={(e) => handleLinkedRadiusChange(e.target.value)}
              onBlur={(e) => handleLinkedRadiusBlur(e.target.value)}
              style={{
                width: "100%",
                padding: "4px 8px",
                fontSize: 12,
                border: "1px solid #e4e4e7",
                borderRadius: 6,
                textAlign: "right",
                boxSizing: "border-box",
              }}
            />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
            {cornersList.map(({ key, label }) => {
              const inherited = activeDevice !== "desktop" ? (desktopRc[key] || desktopRadius || "") : "";
              return (
                <div key={key} style={{ display: "grid", gap: 2, textAlign: "center" }}>
                  <input
                    placeholder={inherited || "0px"}
                    value={rc[key] || (v.radius as string) || ""}
                    onChange={(e) => setCorner(key, e.target.value)}
                    onBlur={(e) => setCornerBlur(key, e.target.value)}
                    style={{
                      width: "100%",
                      padding: "4px",
                      fontSize: 12,
                      border: "1px solid #e4e4e7",
                      borderRadius: 6,
                      textAlign: "center",
                      boxSizing: "border-box",
                    }}
                  />
                  <span style={{ fontSize: 9, color: "#71717a" }}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Border Panel with Linkable 4-Corner Radius
export const borderField = (): CustomField<Record<string, unknown> | undefined> => ({
  type: "custom",
  label: "Border",
  render: ({ value, onChange }) => <BorderControl value={value} onChange={onChange} />,
});

function BoxShadowControl({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown> | undefined) => void;
}) {
  const activeDevice = useBricksActiveDevice();
  const puck = usePuck();
  const v = (value as Record<string, unknown> | undefined) || {};

  const selectedProps = puck?.selectedItem?.props as Record<string, unknown> | undefined;
  const desktopShadow = (selectedProps?.boxShadow as Record<string, unknown>) || {};

  const set = (k: string, val: unknown) => {
    const next = { ...v, [k]: val !== undefined && val !== "" ? val : undefined };
    if (Object.values(next).every((x) => x === undefined)) onChange(undefined);
    else onChange(next);
  };

  const SHADOW_DIMENSIONS = [
    { key: "x", label: "X" },
    { key: "y", label: "Y" },
    { key: "blur", label: "Blur" },
    { key: "spread", label: "Spread" },
  ] as const;

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
        {SHADOW_DIMENSIONS.map(({ key, label }) => {
          const rawVal = v[key];
          const inherited = activeDevice !== "desktop" && desktopShadow[key] !== undefined ? String(desktopShadow[key]) : "0";
          return (
            <label key={key} style={{ display: "grid", gap: 2, textAlign: "center" }}>
              <input
                type="number"
                placeholder={inherited}
                value={rawVal !== undefined ? String(rawVal) : ""}
                onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))}
                style={{ width: "100%", padding: "4px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, textAlign: "center", boxSizing: "border-box" }}
              />
              <span style={{ fontSize: 10, color: "#71717a" }}>{label}</span>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={v.inset === true}
            onChange={(e) => set("inset", e.target.checked ? true : undefined)}
          />
          Inset
        </label>
        <ColorPickerSwatch
          label="Shadow Color"
          value={v.color as string | undefined}
          onChange={(hex) => set("color", hex)}
        />
      </div>
    </div>
  );
}

// Box Shadow Panel
export const boxShadowField = (): CustomField<Record<string, unknown> | undefined> => ({
  type: "custom",
  label: "Box Shadow",
  render: ({ value, onChange }) => <BoxShadowControl value={value} onChange={onChange} />,
});

// Helper for compact single-row text / number inputs
export const bricksRowInputField = (
  label: string,
  placeholder = "",
  type: "text" | "number" = "text",
  min?: number,
  max?: number
): CustomField<string | number | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 32 }}>
        <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>{label}</span>
        <input
          type={type}
          min={min}
          max={max}
          placeholder={placeholder}
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(undefined);
            } else if (type === "number") {
              const num = Number(raw);
              onChange(isNaN(num) ? undefined : num);
            } else {
              onChange(raw);
            }
          }}
          onBlur={(e) => {
            if (type === "text") {
              const raw = e.target.value.trim();
              if (raw !== "" && /^-?\d+(\.\d+)?$/.test(raw)) {
                onChange(`${raw}px`);
              }
            }
          }}
          style={{
            width: 120,
            height: 28,
            padding: "0 8px",
            fontSize: 12,
            border: "1px solid #e4e4e7",
            borderRadius: 6,
            textAlign: type === "number" ? "right" : "left",
            boxSizing: "border-box",
            background: "#ffffff",
          }}
        />
      </div>
    );
  },
});

// Helper for compact single-row select dropdowns
export const bricksRowSelectField = (
  label: string,
  options: Record<string, string> | { label: string; value: string }[]
): CustomField<string | undefined> => {
  const normOptions: { label: string; value: string }[] = Array.isArray(options)
    ? options
    : Object.entries(options).map(([value, l]) => ({ label: l, value }));

  return {
    type: "custom",
    label,
    render: ({ value, onChange }) => {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 32 }}>
          <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>{label}</span>
          <select
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            style={{
              minWidth: 120,
              maxWidth: 160,
              height: 28,
              padding: "0 8px",
              fontSize: 12,
              border: "1px solid #e4e4e7",
              borderRadius: 6,
              background: "#ffffff",
              boxSizing: "border-box",
              cursor: "pointer",
            }}
          >
            {normOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    },
  };
};

function TypographyControl({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown> | undefined) => void;
}) {
  const activeDevice = useBricksActiveDevice();
  const puck = usePuck();
  const selectedProps = puck?.selectedItem?.props as Record<string, unknown> | undefined;
  const desktopTypography = (selectedProps?.typography as Record<string, string | undefined>) || {};

  const v: Record<string, unknown> = value || {};
  const set = (k: string, val: unknown) => {
    const next = { ...v, [k]: val || undefined };
    if (Object.values(next).every((x) => !x)) onChange(undefined);
    else onChange(next);
  };

  const inheritedFs = activeDevice !== "desktop" ? desktopTypography.fontSize : undefined;
  const inheritedFw = activeDevice !== "desktop" ? desktopTypography.fontWeight : undefined;
  const inheritedFf = activeDevice !== "desktop" ? desktopTypography.fontFamily : undefined;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Font Family */}
      <div style={{ display: "grid", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#27272a" }}>Font Family</span>
          {inheritedFf && activeDevice !== "desktop" && (
            <span style={{ fontSize: 10, color: "#71717a" }}>Inherit: {inheritedFf}</span>
          )}
        </div>
        <select
          value={(v.fontFamily as string) || ""}
          onChange={(e) => set("fontFamily", e.target.value)}
          style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff" }}
        >
          <option value="">Default (Theme font)</option>
          <option value="Inter, sans-serif">Inter</option>
          <option value="Roboto, sans-serif">Roboto</option>
          <option value="Poppins, sans-serif">Poppins</option>
          <option value="Montserrat, sans-serif">Montserrat</option>
          <option value="'Plus Jakarta Sans', sans-serif">Plus Jakarta Sans</option>
          <option value="'Playfair Display', serif">Playfair Display (Serif)</option>
          <option value="Merriweather, serif">Merriweather (Serif)</option>
          <option value="system-ui, -apple-system, sans-serif">System Sans</option>
          <option value="monospace">Monospace</option>
        </select>
      </div>

      {/* Font Size & Font Weight in a 2-col row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div style={{ display: "grid", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#27272a" }}>Size</span>
            <span style={{ fontSize: 9, color: "#71717a", textTransform: "capitalize" }}>({activeDevice})</span>
          </div>
          <input
            placeholder={inheritedFs ? `${inheritedFs} (inherit)` : "e.g. 18px / 1.5rem"}
            value={(v.fontSize as string) || ""}
            onChange={(e) => {
              const raw = e.target.value;
              set("fontSize", raw);
            }}
            onBlur={(e) => {
              const trimmed = e.target.value.trim();
              const norm = /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
              set("fontSize", norm);
            }}
            style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, boxSizing: "border-box" }}
          />
        </div>

        <div style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#27272a" }}>Weight</span>
          <select
            value={(v.fontWeight as string) || ""}
            onChange={(e) => set("fontWeight", e.target.value)}
            style={{ width: "100%", padding: "5px 6px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff", boxSizing: "border-box" }}
          >
            <option value="">{inheritedFw ? `${inheritedFw} (inherit)` : "Inherit"}</option>
            <option value="300">300 (Light)</option>
            <option value="400">400 (Regular)</option>
            <option value="500">500 (Medium)</option>
            <option value="600">600 (Semi Bold)</option>
            <option value="700">700 (Bold)</option>
            <option value="800">800 (Extra Bold)</option>
          </select>
        </div>
      </div>

      {/* Line Height & Letter Spacing */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#27272a" }}>Line Height</span>
          <input
            placeholder="e.g. 1.4 or 24px"
            value={(v.lineHeight as string) || ""}
            onChange={(e) => set("lineHeight", e.target.value)}
            style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, boxSizing: "border-box" }}
          />
        </div>

        <div style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#27272a" }}>Letter Spacing</span>
          <input
            placeholder="e.g. 0.5px"
            value={(v.letterSpacing as string) || ""}
            onChange={(e) => set("letterSpacing", e.target.value)}
            style={{ width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, boxSizing: "border-box" }}
          />
        </div>
      </div>

      {/* Text Transform */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#27272a" }}>Transform</span>
        <select
          value={(v.textTransform as string) || ""}
          onChange={(e) => set("textTransform", e.target.value)}
          style={{ width: 130, padding: "4px 8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, background: "#fff" }}
        >
          <option value="">Default</option>
          <option value="none">None</option>
          <option value="capitalize">Capitalize</option>
          <option value="uppercase">UPPERCASE</option>
          <option value="lowercase">lowercase</option>
        </select>
      </div>
    </div>
  );
}

// Typography Panel (Font Family, Responsive Size, Weight, Line Height, Letter Spacing, Text Transform)
export const typographyField = (): CustomField<Record<string, unknown> | undefined> => ({
  type: "custom",
  label: "Typography",
  render: ({ value, onChange }) => <TypographyControl value={value} onChange={onChange} />,
});

function MarkdownTextControl({
  value,
  onChange,
  label,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  label: string;
}) {
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });

  const insertFormat = (type: "bold" | "italic" | "link" | "ul" | "ol") => {
    const current = value || "";
    const start = selection.start;
    const end = selection.end;
    const selected = current.slice(start, end);

    let replacement = "";
    if (type === "bold") {
      replacement = selected ? `**${selected}**` : `**bold text**`;
    } else if (type === "italic") {
      replacement = selected ? `*${selected}*` : `*italic text*`;
    } else if (type === "link") {
      replacement = selected ? `[${selected}](https://...)` : `[link text](https://...)`;
    } else if (type === "ul") {
      replacement = selected
        ? selected
            .split("\n")
            .map((l) => (l.startsWith("- ") ? l : `- ${l}`))
            .join("\n")
        : `\n- Item 1\n- Item 2\n`;
    } else if (type === "ol") {
      replacement = selected
        ? selected
            .split("\n")
            .map((l, i) => (/^\d+\.\s+/.test(l) ? l : `${i + 1}. ${l}`))
            .join("\n")
        : `\n1. Item 1\n2. Item 2\n`;
    }

    const next = current.slice(0, start) + replacement + current.slice(end);
    onChange(next);
  };

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#18181b" }}>{label}</span>
        {/* Formatting Toolbar */}
        <div style={{ display: "inline-flex", gap: 2, background: "#f4f4f5", padding: "2px 4px", borderRadius: 4, border: "1px solid #e4e4e7" }}>
          <button
            type="button"
            title="Bold (**text**)"
            onClick={() => insertFormat("bold")}
            style={{ padding: "1px 6px", fontSize: 11, fontWeight: 700, border: 0, background: "transparent", cursor: "pointer", borderRadius: 3, color: "#18181b" }}
          >
            B
          </button>
          <button
            type="button"
            title="Italic (*text*)"
            onClick={() => insertFormat("italic")}
            style={{ padding: "1px 6px", fontSize: 11, fontStyle: "italic", fontWeight: 600, border: 0, background: "transparent", cursor: "pointer", borderRadius: 3, color: "#18181b" }}
          >
            I
          </button>
          <button
            type="button"
            title="Link ([text](url))"
            onClick={() => insertFormat("link")}
            style={{ padding: "1px 5px", fontSize: 11, border: 0, background: "transparent", cursor: "pointer", borderRadius: 3, color: "#18181b" }}
          >
            🔗
          </button>
          <button
            type="button"
            title="Bullet list (- item)"
            onClick={() => insertFormat("ul")}
            style={{ padding: "1px 5px", fontSize: 11, border: 0, background: "transparent", cursor: "pointer", borderRadius: 3, color: "#18181b" }}
          >
            • List
          </button>
          <button
            type="button"
            title="Numbered list (1. item)"
            onClick={() => insertFormat("ol")}
            style={{ padding: "1px 5px", fontSize: 11, border: 0, background: "transparent", cursor: "pointer", borderRadius: 3, color: "#18181b" }}
          >
            1. List
          </button>
        </div>
      </div>
      <textarea
        rows={5}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onSelect={(e) => {
          const target = e.target as HTMLTextAreaElement;
          setSelection({ start: target.selectionStart, end: target.selectionEnd });
        }}
        placeholder="Write text with formatting (supports **bold**, *italic*, [link](url), and lists)"
        style={{ width: "100%", padding: "8px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.4 }}
      />
    </div>
  );
}

// Textarea Field with Markdown Formatting Toolbar (Bold, Italic, Link, Bullet List, Numbered List)
export const markdownTextField = (label: string): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <MarkdownTextControl value={value} onChange={onChange} label={label} />,
});

// Color swatch field for custom colors
export const bricksColorField = (label: string): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 34 }}>
      <span style={{ fontSize: 12, color: "#27272a", fontWeight: 500 }}>{label}</span>
      <ColorPickerSwatch
        label={label}
        value={value}
        onChange={onChange}
      />
    </div>
  ),
});

interface PuckItemRecord {
  type: string;
  props: Record<string, unknown>;
  [key: string]: unknown;
}

function WrappedFieldControl({
  widgetName,
  name,
  field,
  tab,
  group,
  value,
  onChange,
}: {
  widgetName: string;
  name: string;
  field: Field;
  tab: "content" | "style";
  group?: string | undefined;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const activeDevice = useBricksActiveDevice();
  const puck = usePuck();

  // For desktop, value is props[name]
  // For tablet/mobile, value is props.responsive?.[activeDevice]?.[name]
  let effectiveValue = value;
  if (activeDevice !== "desktop" && puck?.selectedItem) {
    const responsiveObj = (puck.selectedItem.props as Record<string, unknown>)?.responsive as
      | Record<string, Record<string, unknown>>
      | undefined;
    effectiveValue = responsiveObj?.[activeDevice]?.[name];
  }

  const handleChange = (newVal: unknown) => {
    if (activeDevice === "desktop") {
      onChange(newVal);
    } else if (puck?.selectedItem && puck?.dispatch) {
      const currentProps = { ...puck.selectedItem.props } as Record<string, unknown>;
      const currentResp = { ...((currentProps.responsive as Record<string, Record<string, unknown>>) || {}) };
      const deviceProps = { ...((currentResp[activeDevice] as Record<string, unknown>) || {}) };

      let nextDeviceProps: Record<string, unknown>;
      if (
        newVal === undefined ||
        newVal === "" ||
        (typeof newVal === "object" && newVal !== null && Object.values(newVal).every((x) => !x))
      ) {
        const { [name]: _omitted, ...rest } = deviceProps;
        nextDeviceProps = rest;
      } else {
        nextDeviceProps = { ...deviceProps, [name]: newVal };
      }

      let nextResp: Record<string, Record<string, unknown>>;
      if (Object.keys(nextDeviceProps).length === 0) {
        const { [activeDevice]: _omittedDev, ...rest } = currentResp;
        nextResp = rest;
      } else {
        nextResp = { ...currentResp, [activeDevice]: nextDeviceProps };
      }

      const updatedResponsive = Object.keys(nextResp).length > 0 ? nextResp : undefined;
      const itemId = (puck.selectedItem.props as Record<string, unknown>).id as string;

      puck.dispatch({
        type: "setData",
        data: (prevData) => {
          const updateTree = (items: PuckItemRecord[]): PuckItemRecord[] =>
            (items || []).map((item) => {
              if (item.props?.id === itemId) {
                return {
                  ...item,
                  props: {
                    ...item.props,
                    responsive: updatedResponsive,
                  },
                };
              }
              if (item.props) {
                let hasModifiedChild = false;
                const nextProps = { ...item.props };
                for (const [key, val] of Object.entries(nextProps)) {
                  if (
                    Array.isArray(val) &&
                    val.length > 0 &&
                    typeof val[0] === "object" &&
                    val[0] !== null &&
                    "props" in val[0] &&
                    (val[0] as PuckItemRecord).props?.id
                  ) {
                    const updatedChildren = updateTree(val as PuckItemRecord[]);
                    if (updatedChildren !== val) {
                      nextProps[key] = updatedChildren;
                      hasModifiedChild = true;
                    }
                  }
                }
                if (hasModifiedChild) {
                  return { ...item, props: nextProps };
                }
              }
              return item;
            });

          const newContent = updateTree((prevData.content as PuckItemRecord[]) || []);
          const newZones: Record<string, PuckItemRecord[]> = {};
          if (prevData.zones) {
            for (const [zKey, zItems] of Object.entries(prevData.zones)) {
              newZones[zKey] = updateTree((zItems as PuckItemRecord[]) || []);
            }
          }
          return {
            ...prevData,
            content: newContent,
            zones: newZones,
          };
        },
      });
    } else {
      onChange(newVal);
    }
  };

  return (
    <BricksFieldGate blockType={widgetName} tab={tab} group={group}>
      <div key={`${name}_${activeDevice}`} style={{ display: "contents" }}>
        {field.type === "custom" ? (
          <AutoField field={field} value={effectiveValue} onChange={handleChange} />
        ) : (
          <FieldLabel label={(field as { label?: string }).label ?? name}>
            <AutoField field={field} value={effectiveValue} onChange={handleChange} />
          </FieldLabel>
        )}
      </div>
    </BricksFieldGate>
  );
}

// =============================================================================
// MAIN ACCORDION & TABS BUILDER EXPORT FOR BLOCK CONFIG
// =============================================================================

export function createBricksLayoutFields(
  widgetName: string,
  extraContentFields: Record<string, Field> = {},
  options: { includeDisplayControls?: boolean } = { includeDisplayControls: true }
): Record<string, Field> {
  const { [SLOT_PROP]: slotField, ...restExtra } = extraContentFields;

  const out: Record<string, Field> = {};

  // Slot field must be top-level for Puck
  if (slotField) {
    out[SLOT_PROP] = slotField;
  }

  // 1. TOP TABS HEADER (Content | Style)
  out[BRICKS_TAB_HEADER_KEY] = {
    type: "custom",
    label: "",
    render: () => (
      <BricksTabsHeader
        blockType={widgetName}
        tabs={[
          { id: "content", label: "Content", icon: BricksIcons.content },
          { id: "style", label: "Style", icon: BricksIcons.style },
        ]}
      />
    ),
  } as CustomField<undefined>;

  // Helper to wrap fields in gate with responsive awareness
  const wrap = (name: string, field: Field, tab: "content" | "style", group?: string): Field => ({
    type: "custom",
    label: (field as { label?: string }).label ?? name,
    render: ({ value, onChange }) => (
      <WrappedFieldControl
        widgetName={widgetName}
        name={name}
        field={field}
        tab={tab}
        group={group}
        value={value}
        onChange={onChange}
      />
    ),
  });

  // CONTENT TAB FIELDS
  for (const [name, field] of Object.entries(restExtra)) {
    out[name] = wrap(name, field, "content");
  }

  // Display & Flex controls (only if enabled, e.g. for layout containers or blocks that support children)
  if (options.includeDisplayControls !== false) {
    // Display
    out.display = wrap(
      "display",
      bricksSegmentedField("Display", [
        { value: "flex", icon: BricksIcons.displayFlex, tooltip: "Flex" },
        { value: "grid", icon: BricksIcons.displayGrid, tooltip: "Grid" },
        { value: "block", icon: BricksIcons.displayBlock, tooltip: "Block" },
        { value: "inline", icon: BricksIcons.displayInline, tooltip: "Inline" },
        { value: "none", icon: BricksIcons.displayNone, tooltip: "None" },
      ]),
      "content"
    );

    // Direction
    out.direction = wrap(
      "direction",
      bricksSegmentedField("Direction", [
        { value: "row", icon: BricksIcons.dirRow, tooltip: "Row (Horizontal)" },
        { value: "column", icon: BricksIcons.dirColumn, tooltip: "Column (Vertical)" },
        { value: "row-reverse", label: "R-Rev", tooltip: "Row Reverse" },
        { value: "column-reverse", label: "C-Rev", tooltip: "Column Reverse" },
      ]),
      "content"
    );

    // Align Main Axis
    out.alignMainAxis = wrap(
      "alignMainAxis",
      bricksSegmentedField("Align Main Axis", [
        { value: "flex-start", icon: BricksIcons.justifyStart, tooltip: "Flex Start" },
        { value: "center", icon: BricksIcons.justifyCenter, tooltip: "Center" },
        { value: "flex-end", icon: BricksIcons.justifyEnd, tooltip: "Flex End" },
        { value: "space-between", icon: BricksIcons.justifyBetween, tooltip: "Space Between" },
        { value: "space-around", icon: BricksIcons.justifyAround, tooltip: "Space Around" },
        { value: "space-evenly", icon: BricksIcons.justifyEvenly, tooltip: "Space Evenly" },
      ]),
      "content"
    );

    // Align Cross Axis
    out.alignCrossAxis = wrap(
      "alignCrossAxis",
      bricksSegmentedField("Align Cross Axis", [
        { value: "flex-start", icon: BricksIcons.alignStart, tooltip: "Flex Start" },
        { value: "center", icon: BricksIcons.alignCenter, tooltip: "Center" },
        { value: "flex-end", icon: BricksIcons.alignEnd, tooltip: "Flex End" },
        { value: "stretch", icon: BricksIcons.alignStretch, tooltip: "Stretch" },
        { value: "baseline", icon: BricksIcons.alignBaseline, tooltip: "Baseline" },
      ]),
      "content"
    );

    // Align Self
    out.alignSelf = wrap(
      "alignSelf",
      bricksSegmentedField("Align Self", [
        { value: "auto", icon: BricksIcons.alignAuto, tooltip: "Auto" },
        { value: "flex-start", icon: BricksIcons.alignStart, tooltip: "Flex Start" },
        { value: "center", icon: BricksIcons.alignCenter, tooltip: "Center" },
        { value: "flex-end", icon: BricksIcons.alignEnd, tooltip: "Flex End" },
        { value: "stretch", icon: BricksIcons.alignStretch, tooltip: "Stretch" },
      ]),
      "content"
    );

    // Flex Wrap
    out.flexWrap = wrap(
      "flexWrap",
      bricksSegmentedField("Flex Wrap", [
        { value: "nowrap", label: "No Wrap", tooltip: "nowrap" },
        { value: "wrap", label: "Wrap", tooltip: "wrap" },
        { value: "wrap-reverse", label: "Reverse", tooltip: "wrap-reverse" },
      ]),
      "content"
    );

    // Gaps & Order (Single compact row)
    out.gap = wrap("gap", bricksRowInputField("Gap", "e.g. 16px") as Field, "content");
    out.colGap = wrap("colGap", bricksRowInputField("Col Gap", "e.g. 16px") as Field, "content");
    out.rowGap = wrap("rowGap", bricksRowInputField("Row Gap", "e.g. 16px") as Field, "content");
    out.order = wrap("order", bricksRowInputField("Order", "0", "number", -999, 999) as Field, "content");
  }

  // STYLE TAB GROUPS
  // Group 1: Layout (Spacing & Sizing)
  out[`${BRICKS_GROUP_PREFIX}layout`] = wrap(
    "group_layout",
    {
      type: "custom",
      label: "",
      render: () => (
        <BricksGroupHeader
          blockType={widgetName}
          groupId="layout"
          title="Layout (Spacing & Sizing)"
          icon={BricksIcons.layout}
        />
      ),
    } as CustomField<undefined>,
    "style"
  );
  out.margin = wrap("margin", quadField("Margin") as Field, "style", "layout");
  out.padding = wrap("padding", quadField("Padding") as Field, "style", "layout");
  out.sizing = wrap("sizing", sizingField() as Field, "style", "layout");

  // Group: Typography
  out[`${BRICKS_GROUP_PREFIX}typography`] = wrap(
    "group_typography",
    {
      type: "custom",
      label: "",
      render: () => (
        <BricksGroupHeader
          blockType={widgetName}
          groupId="typography"
          title="Typography"
          icon={BricksIcons.typography}
        />
      ),
    } as CustomField<undefined>,
    "style"
  );
  out.typography = wrap("typography", typographyField() as Field, "style", "typography");

  // Group 2: Background
  out[`${BRICKS_GROUP_PREFIX}background`] = wrap(
    "group_background",
    {
      type: "custom",
      label: "",
      render: () => (
        <BricksGroupHeader
          blockType={widgetName}
          groupId="background"
          title="Background"
          icon={BricksIcons.background}
        />
      ),
    } as CustomField<undefined>,
    "style"
  );
  out.background = wrap("background", backgroundField() as Field, "style", "background");

  // Group 3: Border & Box Shadow
  out[`${BRICKS_GROUP_PREFIX}border`] = wrap(
    "group_border",
    {
      type: "custom",
      label: "",
      render: () => (
        <BricksGroupHeader
          blockType={widgetName}
          groupId="border"
          title="Border / Box Shadow"
          icon={BricksIcons.border}
        />
      ),
    } as CustomField<undefined>,
    "style"
  );
  out.border = wrap("border", borderField() as Field, "style", "border");
  out.boxShadow = wrap("boxShadow", boxShadowField() as Field, "style", "border");

  return out;
}

const SLOT_PROP = "content";
