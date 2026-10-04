"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, useSpringNumber } from "../landing/motion.ts";

/** A small order log. Names, cities and amounts are made up and labelled Sample data. */
const FEED = [
  { who: "Ananya R.", city: "Pune", rupees: 1249 },
  { who: "Kabir S.", city: "Jaipur", rupees: 899 },
  { who: "Meera D.", city: "Guwahati", rupees: 2450 },
  { who: "Rohan P.", city: "Indore", rupees: 649 },
  { who: "Isha T.", city: "Kochi", rupees: 1799 },
  { who: "Vikram N.", city: "Surat", rupees: 1099 },
  { who: "Sana K.", city: "Lucknow", rupees: 3250 },
  { who: "Dev M.", city: "Nagpur", rupees: 749 },
];
const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
interface Row { id: string; who: string; city: string; rupees: number }

export function SkyLog() {
  const [rows, setRows] = useState<Row[]>(() => FEED.slice(0, 3).map((r, i) => ({ ...r, id: `s${i}` })));
  const [fresh, setFresh] = useState<string | null>(null);
  const cursor = useRef(3);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const i = cursor.current;
      cursor.current = i + 1;
      const base = FEED[i % FEED.length] ?? FEED[0];
      if (!base) return;
      const row: Row = { ...base, id: `n${i}` };
      setRows((r) => [row, ...r].slice(0, 3));
      setFresh(row.id);
    }, 4400);
    return () => window.clearInterval(t);
  }, []);

  const total = rows.reduce((s, r) => s + r.rupees, 0);
  const shown = useSpringNumber(total);

  return (
    <div className="w-full rounded-2xl p-4" style={{ background: "var(--sk-panel-2)", border: "1px solid var(--sk-line)", boxShadow: "0 24px 50px -24px rgb(0 0 0 / 0.8)" }} role="img" aria-label="Sample order log with made-up orders">
      <div className="flex items-center justify-between">
        <p className="sk-display text-base">Order log</p>
        <span className="rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold" style={{ background: "rgb(139 123 255 / 0.2)", color: "#cfc8ff" }}>Sample data</span>
      </div>
      <ul className="mt-3" aria-hidden="true">
        {rows.map((r) => (
          <li key={r.id} className={`flex items-center justify-between gap-3 py-2 ${r.id === fresh ? "sk-row-new" : ""}`} style={{ borderTop: "1px solid var(--sk-line)" }}>
            <span className="min-w-0 truncate text-[0.95rem]">{r.who} <span className="sk-dim">· {r.city}</span></span>
            <span className="sk-num shrink-0 font-semibold">₹{inr(r.rupees)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-end justify-between pt-3" style={{ borderTop: "1px solid var(--sk-line)" }}>
        <span className="sk-dim text-sm">Cash on delivery, last three</span>
        <span className="sk-display sk-num text-2xl" style={{ color: "var(--sk-gold)" }}>₹{inr(shown)}</span>
      </div>
    </div>
  );
}
