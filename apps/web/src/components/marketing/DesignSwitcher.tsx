"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MARKETING_DESIGNS } from "./designs.ts";

/**
 * Testing aid: a small floating menu to flip between landing page designs. Deliberately neutral (system font, dark
 * pill) so it belongs to neither design. Rendered only when the page enables it.
 */
export function DesignSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (id: string) => {
    setOpen(false);
    router.replace(`${pathname}?design=${id}`, { scroll: false });
  };

  const active = MARKETING_DESIGNS.find((d) => d.id === current);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left: 16, bottom: 16, zIndex: 2147483000, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}
    >
      {open && (
        <ul
          role="menu"
          aria-label="Landing page design"
          style={{ listStyle: "none", margin: "0 0 8px", padding: 6, minWidth: 270, background: "#111827", color: "#f9fafb", borderRadius: 12, boxShadow: "0 18px 40px rgb(0 0 0 / 0.45)", border: "1px solid #374151" }}
        >
          {MARKETING_DESIGNS.map((d) => (
            <li key={d.id} role="none">
              <button
                role="menuitemradio"
                aria-checked={d.id === current}
                disabled={!d.built}
                onClick={() => choose(d.id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: 0, borderRadius: 8, cursor: d.built ? "pointer" : "not-allowed",
                  background: d.id === current ? "#2563eb" : "transparent", color: d.built ? "#f9fafb" : "#6b7280", font: "inherit",
                }}
              >
                <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{d.id === current ? "● " : "○ "}{d.label}</span>
                <span style={{ display: "block", fontSize: 12, opacity: 0.85 }}>{d.note}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "9px 14px", borderRadius: 999, border: "1px solid #374151", background: "#111827", color: "#f9fafb", font: "600 13px system-ui, sans-serif", cursor: "pointer", boxShadow: "0 8px 24px rgb(0 0 0 / 0.4)" }}
      >
        Design: {active ? active.label : "Home 1"}
      </button>
    </div>
  );
}
