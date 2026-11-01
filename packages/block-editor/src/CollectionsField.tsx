import { useEffect, useMemo, useState } from "react";
import type { CustomField } from "@puckeditor/core";
import { useHost } from "./context.tsx";

const box = { border: "1px solid #ddd", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%" } as const;

interface CollectionOption {
  slug: string;
  title: string;
}

/**
 * Multi-select of the store's own collections, in the order they were picked (that is the order on the page).
 * Hosts without a collections list (the Super Admin theme editor has no store) fall back to typing slugs.
 */
function CollectionsSelect({ value, onChange, name, label, max, kind }: { value: string[] | undefined; onChange: (v: string[]) => void; name: string; label: string; max: number; kind: "collection" | "category" }) {
  const hostCtx = useHost();
  // The category picker reuses this component: same UI, its own list and wording.
  const host = hostCtx ? { listCollections: kind === "category" ? hostCtx.listCategories : hostCtx.listCollections } : hostCtx;
  const nounPl = kind === "category" ? "categories" : "collections";
  const nounSg = kind === "category" ? "category" : "collection";
  const [options, setOptions] = useState<CollectionOption[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = value ?? [];

  useEffect(() => {
    let mounted = true;
    if (host?.listCollections) {
      host
        .listCollections()
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
  const visible = (options ?? []).filter((o) => !query.trim() || o.title.toLowerCase().includes(query.trim().toLowerCase()) || o.slug.includes(query.trim().toLowerCase()));
  const toggle = (slug: string) => {
    if (selected.includes(slug)) onChange(selected.filter((s) => s !== slug));
    else if (selected.length < max) onChange([...selected, slug]);
  };

  if (!host?.listCollections || options === null || options.length === 0) {
    return (
      <div>
        <label htmlFor={name} style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
          {label}
        </label>
        <textarea
          id={name}
          rows={3}
          defaultValue={selected.join("\n")}
          onChange={(e) => onChange(e.target.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, max))}
          style={{ ...box, padding: 8 }}
        />
        <span style={{ fontSize: 11, color: "#666" }}>
          {host?.listCollections && options !== null ? `This store has no ${nounPl} yet. ` : ""}One {nounSg} slug per line
        </span>
      </div>
    );
  }

  return (
    <div>
      <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>{label}</span>
      {selected.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {selected.map((slug) => (
            <span key={slug} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f1f5f9", borderRadius: 999, padding: "3px 6px 3px 10px", fontSize: 12 }}>
              {titleOf.get(slug) ?? `${slug} (not found)`}
              <button type="button" aria-label={`Remove ${titleOf.get(slug) ?? slug}`} onClick={() => toggle(slug)} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <button type="button" id={name} aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ ...box, textAlign: "left", background: "#fff", cursor: "pointer" }}>
        {selected.length === 0 ? `Choose ${nounPl}…` : `${selected.length} selected, add or remove…`}
      </button>
      {open ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, marginTop: 4, background: "#fff", maxHeight: 240, overflowY: "auto" }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${nounPl}`} aria-label={`Search ${nounPl}`} style={{ ...box, border: 0, borderBottom: "1px solid #eee", borderRadius: 0 }} />
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

export function collectionsField(label: string, max = 24, kind: "collection" | "category" = "collection"): CustomField<string[]> {
  return {
    type: "custom",
    label,
    render: ({ value, onChange, name }) => <CollectionsSelect value={value} onChange={onChange} name={name} label={label} max={max} kind={kind} />,
  };
}
