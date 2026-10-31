import { createPortal } from "react-dom";
import { createElement, useEffect, useMemo, useState, type ReactElement } from "react";
import type { CustomField } from "@puckeditor/core";
import { ICON_WEIGHTS, formatIconValue, resolveIconName, splitIconValue, strokeOf, type IconWeight } from "@bs/icons";

type WeightChoice = IconWeight | "theme";

import type * as CatalogModule from "@bs/icons/catalog";
type Catalog = typeof CatalogModule;

// The 90 KB gzip icon table loads once, the first time any icon field renders, and stays out of the editor's first load.
let catalogPromise: Promise<Catalog> | undefined;
const loadCatalog = () => (catalogPromise ??= import("@bs/icons/catalog"));

const PAGE = 200;
const RECENT_KEY = "bsec:recent-icons";
const RECENT_MAX = 12;
const WEIGHT_KEY = "bsec:icon-weight";
const WEIGHT_LABELS: Record<WeightChoice, string> = { theme: "Theme", thin: "Thin", regular: "Regular", bold: "Bold" };
const WEIGHT_CHOICES: WeightChoice[] = ["theme", "thin", "regular", "bold"];
const strokeFor = (w: WeightChoice) => (w === "theme" ? ICON_WEIGHTS.regular : ICON_WEIGHTS[w]);
// The last chosen stroke weight is the default for the next pick, so it is not chosen every time. Per browser, guarded.
const readWeight = (): WeightChoice => {
  try {
    const w = localStorage.getItem(WEIGHT_KEY);
    return w === "thin" || w === "regular" || w === "bold" ? w : "theme";
  } catch {
    return "theme";
  }
};
const saveWeight = (w: WeightChoice) => {
  try {
    localStorage.setItem(WEIGHT_KEY, w);
  } catch {
    /* storage unavailable: the weight just is not remembered */
  }
};
// Per-browser convenience only: storage can be blocked or empty, so every access is guarded.
const readRecent = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && resolveIconName(x) === x).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};
const saveRecent = (name: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...readRecent().filter((n) => n !== name)].slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable: recent icons simply are not remembered */
  }
};
const box = { border: "1px solid #ddd", borderRadius: 6, background: "#fff", fontSize: 13 } as const;

function Glyph({ catalog, name, px, stroke = 1.75 }: { catalog: Catalog; name: string; px: number; stroke?: number }): ReactElement | null {
  const node = catalog.ICON_DATA[name];
  if (!node) return null;
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {node.map(([tag, attrs], i) => createElement(tag, { ...attrs, key: i }))}
    </svg>
  );
}

function IconPicker({ value, onChange, label, allowEmpty }: { value: string | undefined; onChange: (v: string | undefined) => void; label: string; allowEmpty: boolean }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [category, setCategory] = useState("all");
  const [weight, setWeight] = useState<WeightChoice>("theme");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void loadCatalog().then((c) => live && setCatalog(c));
    return () => {
      live = false;
    };
  }, []);

  const current = resolveIconName(value);
  const currentWeight: WeightChoice = value && strokeOf(value) !== undefined ? splitIconValue(value).weight : "theme";
  const results = useMemo(() => {
    if (!catalog || !open) return [];
    const found = catalog.searchIcons(query, 2000);
    return category === "all" ? found : catalog.iconsInCategory(category, found);
  }, [catalog, open, query, category]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setCategory("all");
    setShown(PAGE);
  };

  const pick = (name: string | undefined) => {
    if (name) saveRecent(name);
    onChange(name ? formatIconValue(name, weight) : undefined);
    close();
  };

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label}: ${current ?? "none"}. Change icon`}
        onClick={() => {
          setRecent(readRecent());
          setWeight(readWeight());
          setOpen((o) => !o);
        }}
        style={{ ...box, display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ display: "inline-flex", width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
          {catalog && current ? <Glyph catalog={catalog} name={current} px={20} stroke={strokeFor(currentWeight)} /> : null}
        </span>
        <span style={{ flex: 1, color: current ? "#18181b" : "#71717a" }}>{current ? `${current}${currentWeight === "theme" ? "" : ` · ${WEIGHT_LABELS[currentWeight].toLowerCase()}`}` : "No icon"}</span>
        <span aria-hidden>▾</span>
      </button>
      {open
        ? createPortal(
            <div
              onMouseDown={(e) => e.target === e.currentTarget && close()}
              style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Choose icon: ${label}`}
                onKeyDown={(e) => e.key === "Escape" && close()}
                style={{ ...box, color: "#18181b", colorScheme: "light", width: "min(760px, 100%)", height: "min(640px, 100%)", display: "flex", flexDirection: "column", padding: 16, gap: 12, boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>Choose an icon</strong>
                  <button type="button" aria-label="Close" onClick={close} style={{ ...box, padding: "2px 10px", cursor: "pointer", fontSize: 16 }}>
                    ×
                  </button>
                </div>
                <input
                  type="search"
                  value={query}
                  autoFocus
                  placeholder="Search icons (truck, shield, heart…)"
                  aria-label="Search icons"
                  maxLength={40}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShown(PAGE);
                  }}
                  style={{ ...box, width: "100%", padding: "8px 10px", boxSizing: "border-box" }}
                />
                <div role="tablist" aria-label="Icon categories" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[{ id: "all", label: "All" }, ...(catalog?.ICON_CATEGORIES ?? [])].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      role="tab"
                      aria-selected={category === cat.id}
                      onClick={() => {
                        setCategory(cat.id);
                        setShown(PAGE);
                      }}
                      style={{ ...box, padding: "3px 10px", borderRadius: 999, cursor: "pointer", fontSize: 12, background: category === cat.id ? "#18181b" : "#fff", color: category === cat.id ? "#fff" : "#18181b" }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
                {catalog && recent.length > 0 && !query && category === "all" ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#71717a", marginBottom: 4 }}>Recently used</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {recent.map((n) => (
                        <button key={n} type="button" title={n} aria-label={`Recently used: ${n}`} onClick={() => pick(n)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 6, cursor: "pointer", border: n === current ? "1px solid #18181b" : "1px solid #e4e4e7", background: "#fff" }}>
                          <Glyph catalog={catalog} name={n} px={22} stroke={strokeFor(weight)} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  {!catalog ? <p style={{ margin: 0, color: "#666" }}>Loading icons…</p> : null}
                  {catalog && results.length === 0 ? <p style={{ margin: 0, color: "#666" }}>No icon matches “{query}”.</p> : null}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))", gap: 6 }}>
                    {catalog &&
                      results.slice(0, shown).map((n) => (
                        <button
                          key={n}
                          type="button"
                          title={n}
                          aria-label={n}
                          aria-pressed={n === current}
                          onClick={() => pick(n)}
                          style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 52, borderRadius: 6, cursor: "pointer", border: n === current ? "1px solid #18181b" : "1px solid transparent", background: n === current ? "#f4f4f5" : "transparent" }}
                        >
                          <Glyph catalog={catalog} name={n} px={24} stroke={strokeFor(weight)} />
                        </button>
                      ))}
                  </div>
                  {results.length > shown ? (
                    <button type="button" onClick={() => setShown((s) => s + PAGE * 3)} style={{ ...box, padding: "6px 12px", cursor: "pointer", margin: "12px auto 0", display: "block" }}>
                      Show more ({results.length - shown})
                    </button>
                  ) : null}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "#71717a" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Stroke</span>
                    <div role="radiogroup" aria-label="Icon stroke" style={{ display: "inline-flex", gap: 4 }}>
                      {WEIGHT_CHOICES.map((w) => (
                        <button
                          key={w}
                          type="button"
                          role="radio"
                          aria-checked={weight === w}
                          onClick={() => {
                            setWeight(w);
                            saveWeight(w);
                            if (current) onChange(formatIconValue(current, w));
                          }}
                          style={{ ...box, padding: "3px 10px", cursor: "pointer", background: weight === w ? "#18181b" : "#fff", color: weight === w ? "#fff" : "#18181b" }}
                        >
                          {WEIGHT_LABELS[w]}
                        </button>
                      ))}
                    </div>
                    <span>{results.length} icons</span>
                  </div>
                  {allowEmpty ? (
                    <button type="button" onClick={() => pick(undefined)} style={{ ...box, padding: "4px 10px", cursor: "pointer", color: "#18181b" }}>
                      No icon
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Puck field that picks any Lucide icon (ADR-041). Stores the kebab-case Lucide name; legacy names still display. */
export const iconField = (label: string, allowEmpty = false): CustomField<string | undefined> => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <IconPicker value={value} onChange={onChange} label={label} allowEmpty={allowEmpty} />,
});
