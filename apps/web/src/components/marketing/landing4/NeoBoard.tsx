"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, useSpringNumber } from "../landing/motion.ts";

/** A sample store dashboard. All numbers and names are made up and labelled so; orders tick in every few seconds. */
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

export function NeoBoard() {
  const [rows, setRows] = useState<Row[]>(() => FEED.slice(0, 3).map((r, i) => ({ ...r, id: `s${i}` })));
  const [count, setCount] = useState(12);
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
      setCount((c) => c + 1);
      setFresh(row.id);
    }, 4200);
    return () => window.clearInterval(t);
  }, []);

  const animated = useSpringNumber(count, { stiffness: 260, damping: 22 });
  const revenue = useSpringNumber(count * 1480, { stiffness: 140, damping: 18 });

  return (
    <div className="grid w-full max-w-[34rem] grid-cols-6 gap-4" role="img" aria-label="Sample store dashboard with made-up orders">
      <div className="nb-box nb-pop nb-y col-span-3 p-4" style={{ ["--d" as string]: "100ms" } as React.CSSProperties}>
        <p className="text-sm font-bold">Orders today</p>
        <p className="nb-display nb-num text-5xl">{Math.round(animated)}</p>
      </div>
      <div className="nb-box nb-pop nb-p col-span-3 p-4" style={{ ["--d" as string]: "200ms" } as React.CSSProperties}>
        <p className="text-sm font-bold">COD to collect</p>
        <p className="nb-display nb-num text-[2rem] leading-[1.35]">₹{inr(revenue)}</p>
      </div>
      <div className="nb-box nb-pop col-span-6 p-4" style={{ ["--d" as string]: "300ms" } as React.CSSProperties}>
        <div className="flex items-center justify-between">
          <p className="nb-display text-lg">Latest orders</p>
          <span className="nb-flat nb-live bg-white px-2 py-0.5 text-xs font-bold">Sample data</span>
        </div>
        <ul className="mt-2" aria-hidden="true">
          {rows.map((r) => (
            <li key={r.id} className={`flex items-center justify-between gap-3 py-2 ${r.id === fresh ? "nb-row-new" : ""}`} style={{ borderTop: "2px solid var(--nb-ink)" }}>
              <span className="min-w-0 truncate font-semibold">{r.who} <span className="font-normal opacity-70">· {r.city}</span></span>
              <span className="nb-num shrink-0 font-black">₹{inr(r.rupees)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="nb-box nb-pop nb-l col-span-3 p-3" style={{ ["--d" as string]: "400ms" } as React.CSSProperties}>
        <p className="text-xs font-bold">GST invoice</p>
        <p className="nb-num text-sm font-semibold">CGST 9% + SGST 9%</p>
      </div>
      <div className="nb-box nb-pop nb-bl col-span-3 p-3" style={{ ["--d" as string]: "500ms" } as React.CSSProperties}>
        <p className="text-xs font-bold">Theme</p>
        <p className="text-sm font-semibold">Fashion Editorial</p>
      </div>
    </div>
  );
}
