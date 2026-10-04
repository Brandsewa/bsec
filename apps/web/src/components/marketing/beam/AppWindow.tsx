"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../landing/motion.ts";

/**
 * The product window lit by the beam: our store admin's order board. Every name, city and amount is made up and the
 * window says so. A new order drops into "Placed" every few seconds.
 */
interface Order { id: string; no: string; who: string; city: string; rupees: number }

const FEED: Omit<Order, "id" | "no">[] = [
  { who: "Ananya R.", city: "Pune", rupees: 1249 },
  { who: "Kabir S.", city: "Jaipur", rupees: 899 },
  { who: "Meera D.", city: "Guwahati", rupees: 2450 },
  { who: "Rohan P.", city: "Indore", rupees: 649 },
  { who: "Isha T.", city: "Kochi", rupees: 1799 },
  { who: "Vikram N.", city: "Surat", rupees: 1099 },
  { who: "Sana K.", city: "Lucknow", rupees: 3250 },
  { who: "Dev M.", city: "Nagpur", rupees: 749 },
];
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function mk(i: number): Order {
  const base = FEED[i % FEED.length] ?? FEED[0];
  return { who: base?.who ?? "", city: base?.city ?? "", rupees: base?.rupees ?? 0, id: `o${i}`, no: `ORD-${String(100 + i).padStart(5, "0")}` };
}

const NAV = ["Orders", "Products", "Customers", "Segments", "Themes", "Returns", "Settings"];
const ACTIVITY = [
  ["Ananya R. placed an order", "COD ₹1,249"],
  ["Return requested", "ORD-00098"],
  ["Segment refreshed", "Win-back · 24"],
  ["Theme published", "Fashion Editorial"],
  ["Invoice issued", "CGST 9% + SGST 9%"],
];

function Card({ o, fresh }: { o: Order; fresh: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${fresh ? "bm-card-new" : ""}`} style={{ background: "#141722", border: "1px solid rgb(255 255 255 / 0.09)" }}>
      <div className="flex items-center justify-between text-[0.7rem]">
        <span className="bm-num" style={{ color: "#8f94b0" }}>{o.no}</span>
        <span className="rounded px-1.5 py-0.5 font-semibold" style={{ background: "rgb(255 154 77 / 0.16)", color: "#ffb27a" }}>COD</span>
      </div>
      <p className="mt-1.5 truncate text-[0.82rem] font-medium">{o.who} <span style={{ color: "#8f94b0" }}>· {o.city}</span></p>
      <p className="bm-num mt-1 text-[0.95rem] font-semibold">{inr(o.rupees)}</p>
    </div>
  );
}

export function AppWindow() {
  const [placed, setPlaced] = useState<Order[]>(() => [mk(3), mk(2)]);
  const [fresh, setFresh] = useState<string | null>(null);
  const cursor = useRef(4);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const o = mk(cursor.current);
      cursor.current += 1;
      setPlaced((p) => [o, ...p].slice(0, 3));
      setFresh(o.id);
    }, 4600);
    return () => window.clearInterval(t);
  }, []);

  const confirmed = [mk(1), mk(0)];
  const shipped = [mk(7)];

  return (
    <div className="bm-window h-[24rem] overflow-hidden sm:h-[34rem]" role="img" aria-label="Sample store admin order board with made-up orders">
      <div className="flex h-full" style={{ color: "#eceef7" }}>
        {/* sidebar */}
        <aside className="hidden w-52 shrink-0 flex-col gap-1 p-4 md:flex" style={{ borderRight: "1px solid rgb(255 255 255 / 0.08)" }} aria-hidden="true">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold" style={{ background: "linear-gradient(135deg,#8f8dff,#6f8bff)", color: "#0a0a12" }}>b</span>
            <span className="text-sm font-semibold">Demo Store</span>
          </div>
          {NAV.map((n, i) => (
            <span key={n} className="rounded-lg px-2.5 py-1.5 text-[0.85rem]" style={i === 0 ? { background: "rgb(143 141 255 / 0.16)", color: "#fff" } : { color: "#9ea4bd" }}>{n}</span>
          ))}
        </aside>

        {/* board */}
        <div className="min-w-0 flex-1 p-4 sm:p-5" aria-hidden="true">
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold tracking-tight">Orders</p>
            <span className="rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold" style={{ background: "rgb(143 141 255 / 0.18)", color: "#cfceff" }}>Sample data</span>
          </div>
          <div className="mt-3 flex gap-5 text-[0.82rem]" style={{ color: "#9ea4bd" }}>
            <span style={{ color: "#fff", borderBottom: "2px solid #8f8dff", paddingBottom: 6 }}>Board</span><span>List</span><span>COD pending</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[["Placed", placed], ["Confirmed", confirmed], ["Shipped", shipped]].map(([title, items], col) => (
              <div key={title as string}>
                <p className="mb-2 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-wider" style={{ color: "#9ea4bd" }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: ["#ff9a4d", "#8f8dff", "#5eead4"][col] }} />
                  {title as string} <span className="bm-num">{(items as Order[]).length}</span>
                </p>
                <div className="space-y-2.5">
                  {(items as Order[]).map((o, i) => (
                    <div key={o.id} className="bm-card-in" style={{ ["--d" as string]: `${700 + col * 140 + i * 120}ms` } as React.CSSProperties}>
                      <Card o={o} fresh={o.id === fresh} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* activity */}
        <aside className="hidden w-64 shrink-0 p-4 lg:block" style={{ borderLeft: "1px solid rgb(255 255 255 / 0.08)" }} aria-hidden="true">
          <p className="text-sm font-semibold">Activity</p>
          <ul className="mt-3 space-y-3">
            {ACTIVITY.map(([a, b], i) => (
              <li key={a} className="bm-card-in flex gap-2.5" style={{ ["--d" as string]: `${900 + i * 120}ms` } as React.CSSProperties}>
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i === 0 ? "#8f8dff" : "#3a3f57" }} />
                <span className="min-w-0 text-[0.8rem] leading-snug"><span className="block truncate">{a}</span><span style={{ color: "#8f94b0" }}>{b}</span></span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
