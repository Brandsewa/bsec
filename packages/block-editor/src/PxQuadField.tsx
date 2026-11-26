import { useState } from "react";
import type { CustomField } from "@puckeditor/core";
import { usePuck } from "@puckeditor/core";

type Quad = { top?: number; right?: number; bottom?: number; left?: number };
const SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * Four boxes (top, right, bottom, left) in pixels, like the padding of the layout settings. A side left empty falls back
 * to the older two-value setting (`legacyX` for left and right, `legacyY` for top and bottom) so blocks saved before the
 * four boxes existed look the same. Stores only the sides that were typed.
 */
function PxQuadControl({ label, value, onChange, max, legacyX, legacyY }: { label: string; value: Quad | undefined; onChange: (v: Quad | undefined) => void; max: number; legacyX: string; legacyY: string }) {
  const puck = usePuck();
  const props = puck?.selectedItem?.props as Record<string, unknown> | undefined;
  const fallback = (side: (typeof SIDES)[number]) => {
    const raw = props?.[side === "top" || side === "bottom" ? legacyY : legacyX];
    return typeof raw === "number" ? raw : undefined;
  };
  const v: Quad = value ?? {};
  // Typed text is kept locally so clearing a box is possible while typing.
  const [draft, setDraft] = useState<Partial<Record<(typeof SIDES)[number], string>>>({});

  const commit = (side: (typeof SIDES)[number], raw: string) => {
    const t = raw.trim();
    const n = t === "" ? undefined : Math.max(0, Math.min(max, Math.round(Number(t))));
    const keep = SIDES.filter((k) => k !== side && v[k] !== undefined);
    const next: Quad = Object.fromEntries(keep.map((k) => [k, v[k]]));
    if (n !== undefined && !Number.isNaN(n)) next[side] = n;
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#18181b" }}>{label}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
        {SIDES.map((side) => (
          <label key={side} style={{ display: "grid", gap: 2, textAlign: "center" }}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={max}
              aria-label={`${label} ${side}`}
              placeholder={String(fallback(side) ?? 0)}
              value={draft[side] ?? (v[side] !== undefined ? String(v[side]) : "")}
              onChange={(e) => {
                setDraft((d) => ({ ...d, [side]: e.target.value }));
                commit(side, e.target.value);
              }}
              onBlur={() => setDraft((d) => { const { [side]: _gone, ...rest } = d; return rest; })}
              style={{ width: "100%", padding: "4px", fontSize: 12, border: "1px solid #e4e4e7", borderRadius: 6, textAlign: "center", boxSizing: "border-box" }}
            />
            <span style={{ fontSize: 9, color: "#71717a", textTransform: "uppercase" }}>{side}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export const pxQuadField = (label: string, opts: { max: number; legacyX: string; legacyY: string }): CustomField<Quad | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <PxQuadControl label={label} value={value} onChange={onChange} max={opts.max} legacyX={opts.legacyX} legacyY={opts.legacyY} />,
});
