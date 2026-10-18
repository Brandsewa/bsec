import { useState } from "react";
import type { CustomField } from "@puckeditor/core";
import { PRODUCT_ELEMENT_LABELS, normalizeElementOrder, type ProductElement } from "@bs/blocks";

/**
 * The product page's buy-box elements as a list that is reordered by dragging (or with the arrow buttons, for keyboards
 * and touch). Stored as the full ordered list of element names; an empty list means the default order.
 */
function ElementOrder({ value, onChange, label }: { value: string[] | undefined; onChange: (v: string[]) => void; label: string }) {
  const order = normalizeElementOrder(value);
  const isDefault = !value || value.length === 0;
  const [dragging, setDragging] = useState<ProductElement | null>(null);
  const [over, setOver] = useState<ProductElement | null>(null);

  const move = (from: ProductElement, to: ProductElement) => {
    if (from === to) return;
    const next = order.filter((n) => n !== from);
    next.splice(next.indexOf(to) + (order.indexOf(from) < order.indexOf(to) ? 1 : 0), 0, from);
    onChange(next);
  };
  const step = (name: ProductElement, by: -1 | 1) => {
    const i = order.indexOf(name);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j] as ProductElement, next[i] as ProductElement];
    onChange(next);
  };

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <button type="button" disabled={isDefault} onClick={() => onChange([])} style={{ border: 0, background: "none", fontSize: 11, color: isDefault ? "#a1a1aa" : "#2563eb", cursor: isDefault ? "default" : "pointer", padding: 0 }}>
          Reset order
        </button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {order.map((name, i) => (
          <li
            key={name}
            draggable
            onDragStart={(e) => {
              setDragging(name);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", name);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(name);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) move(dragging, name);
              setDragging(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #e4e4e7", borderRadius: 7, padding: "5px 6px", background: over === name && dragging !== name ? "#eff6ff" : "#fff", opacity: dragging === name ? 0.5 : 1, cursor: "grab", fontSize: 12 }}
          >
            <span aria-hidden="true" style={{ color: "#a1a1aa", letterSpacing: -2, userSelect: "none" }}>⋮⋮</span>
            <span style={{ flex: 1, minWidth: 0 }}>{PRODUCT_ELEMENT_LABELS[name]}</span>
            <button type="button" aria-label={`Move ${PRODUCT_ELEMENT_LABELS[name]} up`} disabled={i === 0} onClick={() => step(name, -1)} style={{ border: 0, background: "none", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1, padding: 2 }}>
              ↑
            </button>
            <button type="button" aria-label={`Move ${PRODUCT_ELEMENT_LABELS[name]} down`} disabled={i === order.length - 1} onClick={() => step(name, 1)} style={{ border: 0, background: "none", cursor: i === order.length - 1 ? "default" : "pointer", opacity: i === order.length - 1 ? 0.3 : 1, padding: 2 }}>
              ↓
            </button>
          </li>
        ))}
      </ul>
      <span style={{ display: "block", fontSize: 11, color: "#71717a", marginTop: 4 }}>Drag a row (or use the arrows) to move it. An element switched off below stays hidden wherever it is.</span>
    </div>
  );
}

export const elementOrderField = (label: string): CustomField<string[]> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <ElementOrder value={value} onChange={onChange} label={label} />,
});
