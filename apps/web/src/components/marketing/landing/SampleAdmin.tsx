"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, useSpringNumber } from "./motion.ts";

/**
 * A sample of the store admin's Orders list. Everything here is synthetic and labelled so: the names, cities and
 * amounts are made up for the page. New orders are "printed in" every few seconds to show the admin at work.
 */
interface SampleOrder {
  id: string;
  number: string;
  who: string;
  city: string;
  rupees: number;
  state: "Needs confirming" | "Confirmed";
}

const FEED: SampleOrder[] = [
  { id: "a", number: "ORD-00118", who: "Ananya R.", city: "Pune", rupees: 1249, state: "Needs confirming" },
  { id: "b", number: "ORD-00117", who: "Kabir S.", city: "Jaipur", rupees: 899, state: "Confirmed" },
  { id: "c", number: "ORD-00116", who: "Meera D.", city: "Guwahati", rupees: 2450, state: "Confirmed" },
  { id: "d", number: "ORD-00115", who: "Rohan P.", city: "Indore", rupees: 649, state: "Confirmed" },
  { id: "e", number: "ORD-00119", who: "Isha T.", city: "Kochi", rupees: 1799, state: "Needs confirming" },
  { id: "f", number: "ORD-00120", who: "Vikram N.", city: "Surat", rupees: 1099, state: "Needs confirming" },
  { id: "g", number: "ORD-00121", who: "Sana K.", city: "Lucknow", rupees: 3250, state: "Needs confirming" },
];

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function SampleAdmin() {
  // Rows currently shown, newest first. The first four are visible; the feed advances every few seconds.
  const [shown, setShown] = useState<SampleOrder[]>(() => FEED.slice(0, 4));
  const [fresh, setFresh] = useState<string | null>(null);
  const cursor = useRef(4);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const c = cursor.current;
      cursor.current = c + 1;
      const next = FEED[c % FEED.length] ?? FEED[0];
      if (!next) return;
      const copy: SampleOrder = { ...next, id: `${next.id}-${c}`, number: `ORD-${String(118 + c - 3).padStart(5, "0")}` };
      setShown((rows) => [copy, ...rows].slice(0, 4));
      setFresh(copy.id);
    }, 4200);
    return () => window.clearInterval(id);
  }, []);

  const total = shown.reduce((sum, o) => sum + o.rupees, 0);
  const animatedTotal = useSpringNumber(total);

  return (
    <div
      className="bz-cotton relative w-full max-w-[34rem] rounded-2xl p-4 sm:p-5"
      style={{ boxShadow: "0 28px 50px -22px rgb(0 0 0 / 0.65), 0 2px 0 rgb(255 255 255 / 0.4) inset" }}
      role="img"
      aria-label="Sample of the store admin orders list with made-up orders"
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <div>
          <p className="text-sm font-semibold" style={{ fontFamily: "var(--bz-display)" }}>Orders</p>
          <p className="bz-muted text-xs">Cash on delivery · today</p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[0.7rem] font-semibold" style={{ background: "#141c55", color: "#f2b22d" }}>
          Sample data
        </span>
      </div>

      <ul className="divide-y" style={{ borderColor: "rgb(20 28 85 / 0.14)" }} aria-hidden="true">
        {shown.map((o) => (
          <li
            key={o.id}
            className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-2.5 sm:grid-cols-[6.2rem_1fr_auto_auto] ${o.id === fresh ? "bz-row-new" : ""}`}
            style={{ borderColor: "rgb(20 28 85 / 0.14)" }}
          >
            <span className="bz-num text-[0.78rem] font-semibold">{o.number}</span>
            <span className="col-start-1 row-start-2 truncate text-sm sm:col-start-auto sm:row-start-auto">
              {o.who} <span className="bz-muted">· {o.city}</span>
            </span>
            <span className="bz-num col-start-2 row-start-1 text-right text-sm font-semibold sm:col-start-auto sm:row-start-auto">{inr(o.rupees)}</span>
            <span
              className="col-start-2 row-start-2 justify-self-end rounded-full px-2 py-0.5 text-[0.68rem] font-semibold sm:col-start-auto sm:row-start-auto"
              style={
                o.state === "Confirmed"
                  ? { background: "#141c55", color: "#f1e9d6" }
                  : { background: "#f2b22d", color: "#141c55" }
              }
            >
              {o.state}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-end justify-between rounded-xl px-3 py-2.5" style={{ background: "#141c55", color: "#f1e9d6" }}>
        <span className="text-xs" style={{ color: "#b9bde0" }}>Last four orders</span>
        <span className="bz-num text-xl font-bold" style={{ fontFamily: "var(--bz-display)" }}>{inr(animatedTotal)}</span>
      </div>
    </div>
  );
}
