"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, useSpringNumber } from "../landing/motion.ts";

/** A printed order slip with made-up orders (labelled Sample data). New orders are stamped on every few seconds. */
interface Slip {
  id: string;
  no: string;
  who: string;
  rupees: number;
}

const FEED: Omit<Slip, "id">[] = [
  { no: "ORD-00118", who: "Ananya R., Pune", rupees: 1249 },
  { no: "ORD-00117", who: "Kabir S., Jaipur", rupees: 899 },
  { no: "ORD-00116", who: "Meera D., Guwahati", rupees: 2450 },
  { no: "ORD-00115", who: "Rohan P., Indore", rupees: 649 },
  { no: "ORD-00119", who: "Isha T., Kochi", rupees: 1799 },
  { no: "ORD-00120", who: "Vikram N., Surat", rupees: 1099 },
  { no: "ORD-00121", who: "Sana K., Lucknow", rupees: 3250 },
  { no: "ORD-00122", who: "Dev M., Nagpur", rupees: 749 },
];

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");

export function RisoSlip() {
  const [rows, setRows] = useState<Slip[]>(() => FEED.slice(0, 4).map((r, i) => ({ ...r, id: `s${i}` })));
  const [fresh, setFresh] = useState<string | null>(null);
  const cursor = useRef(4);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const i = cursor.current;
      cursor.current = i + 1;
      const base = FEED[i % FEED.length] ?? FEED[0];
      if (!base) return;
      const row: Slip = { ...base, id: `n${i}`, no: `ORD-${String(118 + i - 3).padStart(5, "0")}` };
      setRows((r) => [row, ...r].slice(0, 4));
      setFresh(row.id);
    }, 4400);
    return () => window.clearInterval(t);
  }, []);

  const total = rows.reduce((s, r) => s + r.rupees, 0);
  const shown = useSpringNumber(total);

  return (
    <div className="relative w-full max-w-[32rem]" role="img" aria-label="Sample order slip with made-up cash on delivery orders">
      {/* Two spot-ink shapes sit behind the slip, out of register with each other. */}
      <div aria-hidden="true" className="absolute -left-6 -top-8 h-44 w-44 rounded-full" style={{ background: "var(--rz-pink)", mixBlendMode: "multiply" }} />
      <div aria-hidden="true" className="absolute -bottom-8 -right-6 h-48 w-56" style={{ background: "var(--rz-blue)", mixBlendMode: "multiply", clipPath: "polygon(8% 0, 100% 6%, 92% 100%, 0 90%)" }} />
      <div aria-hidden="true" className="absolute right-6 top-10 h-24 w-24" style={{ backgroundImage: "var(--rz-dots-pink)", backgroundSize: "9px 9px", opacity: 0.9 }} />

      <div className="relative bg-white p-4 sm:p-5" style={{ border: "2.5px solid var(--rz-ink)", transform: "rotate(-1.4deg)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="rz-display text-[1.35rem]">Today&apos;s orders</p>
            <p className="rz-scrawl text-xl" style={{ color: "var(--rz-pink)", lineHeight: 1 }}>cash on delivery</p>
          </div>
          <span className="rounded-full px-2.5 py-1 text-[0.72rem] font-bold" style={{ background: "var(--rz-yellow)", border: "2px solid var(--rz-ink)" }}>Sample data</span>
        </div>
        <ul className="mt-3" aria-hidden="true">
          {rows.map((r) => (
            <li key={r.id} className={`flex items-center justify-between gap-3 py-2.5 ${r.id === fresh ? "rz-row-new" : ""}`} style={{ borderTop: "2px dashed rgb(20 20 43 / 0.28)" }}>
              <div className="min-w-0">
                <p className="rz-num text-[0.75rem] font-bold" style={{ color: "var(--rz-blue)" }}>{r.no}</p>
                <p className="truncate text-[0.98rem] font-medium">{r.who}</p>
              </div>
              <p className="rz-num shrink-0 text-lg font-bold" style={{ fontFamily: "var(--rz-display)", letterSpacing: "-0.03em" }}>₹{inr(r.rupees)}</p>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-end justify-between pt-3" style={{ borderTop: "3px solid var(--rz-ink)" }}>
          <span className="rz-scrawl text-2xl">last four</span>
          <span className="rz-num text-3xl font-black" style={{ fontFamily: "var(--rz-display)", letterSpacing: "-0.05em", color: "var(--rz-pink)" }}>₹{inr(shown)}</span>
        </div>
      </div>
    </div>
  );
}
