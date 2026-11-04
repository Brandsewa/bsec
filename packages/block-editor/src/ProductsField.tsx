import { useEffect, useMemo, useState } from "react";
import type { CustomField } from "@puckeditor/core";
import { useHost } from "./context.tsx";

const box = { border: "1px solid #ddd", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%" } as const;

/**
 * Hand-pick the store's products for a block, in the order picked (that is the order on the page).
 * Hosts without a product list (the Super Admin editor has no store) fall back to typing slugs.
 */
function ProductsSelect({ value, onChange, name, label, max }: { value: string[] | undefined; onChange: (v: string[]) => void; name: string; label: string; max: number }) {
  const host = useHost();
  const [options, setOptions] = useState<Array<{ slug: string; title: string }> | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = value ?? [];

  useEffect(() => {
    let mounted = true;
    if (host?.listProducts) {
      host
        .listProducts()
        .then((list) => {
          if (mounted && Array.isArray(list)) setOptions(list);
        })
        .catch(() => {
          if (mounted) setOptions([]);
        });
    }
    return () => {
      mounted = false;
    };
  }, [host]);

  const titleOf = useMemo(() => new Map((options ?? []).map((o) => [o.slug, o.title])), [options]);
  const q = query.trim().toLowerCase();
  const visible = (options ?? []).filter((o) => !q || o.title.toLowerCase().includes(q) || o.slug.includes(q));
  const toggle = (slug: string) => {
    if (selected.includes(slug)) onChange(selected.filter((s) => s !== slug));
    else if (selected.length < max) onChange([...selected, slug]);
  };
  const move = (slug: string, dir: -1 | 1) => {
    const i = selected.indexOf(slug);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    onChange(next);
  };

  if (!host?.listProducts || options === null || options.length === 0) {
    return (
      <div>
        <label htmlFor={name} style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
          {label}
        </label>
        <textarea id={name} rows={3} defaultValue={selected.join("\n")} onChange={(e) => onChange(e.target.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, max))} style={{ ...box, padding: 8 }} />
        <span style={{ fontSize: 11, color: "#666" }}>{host?.listProducts && options !== null ? "This store has no products yet. " : ""}One product slug per line</span>
      </div>
    );
  }

  return (
    <div>
      <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>{label}</span>
      {selected.length > 0 ? (
        <ol style={{ listStyle: "none", margin: "0 0 8px", padding: 0, display: "grid", gap: 4 }}>
          {selected.map((slug, i) => (
            <li key={slug} style={{ display: "flex", alignItems: "center", gap: 6, background: "#f1f5f9", borderRadius: 6, padding: "4px 6px 4px 10px", fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleOf.get(slug) ?? `${slug} (not found)`}</span>
              <button type="button" aria-label={`Move ${titleOf.get(slug) ?? slug} up`} disabled={i === 0} onClick={() => move(slug, -1)} style={{ border: 0, background: "none", cursor: "pointer" }}>
                ↑
              </button>
              <button type="button" aria-label={`Move ${titleOf.get(slug) ?? slug} down`} disabled={i === selected.length - 1} onClick={() => move(slug, 1)} style={{ border: 0, background: "none", cursor: "pointer" }}>
                ↓
              </button>
              <button type="button" aria-label={`Remove ${titleOf.get(slug) ?? slug}`} onClick={() => toggle(slug)} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>
                ×
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <button type="button" id={name} aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ ...box, textAlign: "left", background: "#fff", cursor: "pointer" }}>
        {selected.length === 0 ? "Choose products…" : `${selected.length} selected, add or remove…`}
      </button>
      {open ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, marginTop: 4, background: "#fff", maxHeight: 260, overflowY: "auto" }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products" aria-label="Search products" style={{ ...box, border: 0, borderBottom: "1px solid #eee", borderRadius: 0 }} />
          {visible.length === 0 ? <p style={{ margin: 0, padding: 10, fontSize: 12, color: "#666" }}>No match.</p> : null}
          {visible.map((o) => {
            const on = selected.includes(o.slug);
            return (
              <label key={o.slug} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", fontSize: 13, cursor: "pointer", background: on ? "#f8fafc" : undefined }}>
                <input type="checkbox" checked={on} disabled={!on && selected.length >= max} onChange={() => toggle(o.slug)} />
                {o.title}
              </label>
            );
          })}
        </div>
      ) : null}
      <span style={{ fontSize: 11, color: "#666", display: "block", marginTop: 4 }}>Shown in the order you pick them. Up to {max}.</span>
    </div>
  );
}

export function productsField(label: string, max = 24): CustomField<string[]> {
  return {
    type: "custom",
    label,
    render: ({ value, onChange, name }) => <ProductsSelect value={value} onChange={onChange} name={name} label={label} max={max} />,
  };
}
