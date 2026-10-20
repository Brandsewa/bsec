"use client";
/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * The editor's sample product page is interactive in one small way: picking another size changes the price, compare-at
 * price and saving, as on a real product page. State lives here so the options and the price can sit anywhere in the
 * element order and still agree. This only draws sample numbers; the storefront's real page does not use it.
 */

const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

const SAMPLE_VARIANTS = [
  { label: "50 g", price: 67900, compareAt: 79900 },
  { label: "100 g", price: 119900, compareAt: 139900 },
  { label: "250 g", price: 249900, compareAt: 299900 },
];

const Ctx = createContext<{ index: number; setIndex: (i: number) => void } | null>(null);

export function SampleBuyProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(0);
  return <Ctx.Provider value={{ index, setIndex }}>{children}</Ctx.Provider>;
}

function useSample() {
  return useContext(Ctx) ?? { index: 0, setIndex: () => undefined };
}

export function SampleOptions({ style }: { style: "pills" | "buttons" | "dropdown" }) {
  const { index, setIndex } = useSample();
  return (
    <div className="bsb-pd-opt">
      <span className="bsb-pd-opt-label">
        Size: <span className="bsb-muted">{SAMPLE_VARIANTS[index]?.label}</span>
      </span>
      {style === "dropdown" ? (
        <select className="bsb-pd-select" aria-label="Size" value={index} onChange={(e) => setIndex(Number((e.target as unknown as { value: string }).value))}>
          {SAMPLE_VARIANTS.map((v, i) => (
            <option key={v.label} value={i}>
              {v.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="bsb-pd-opt-row">
          {SAMPLE_VARIANTS.map((v, i) => (
            <button
              key={v.label}
              type="button"
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
              className={cx("bsb-pd-opt-pill", style === "buttons" && "bsb-pd-opt-btn", i === index && "bsb-pd-opt-on")}
              style={{ font: "inherit", cursor: "pointer" }}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SamplePrice({ note }: { note?: string | undefined }) {
  const { index } = useSample();
  const v = SAMPLE_VARIANTS[index] ?? SAMPLE_VARIANTS[0];
  if (!v) return null;
  const saving = Math.round(((v.compareAt - v.price) / v.compareAt) * 100);
  return (
    <div className="bsb-pd-price">
      <div>
        <strong>{money(v.price)}</strong> <s className="bsb-muted">{money(v.compareAt)}</s> <span className="bsb-pd-save">Save {saving}%</span>
      </div>
      {note ? <p className="bsb-muted bsb-pd-note">{note}</p> : null}
    </div>
  );
}
