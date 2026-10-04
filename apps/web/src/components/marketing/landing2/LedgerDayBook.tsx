"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, useSpringNumber } from "../landing/motion.ts";

/**
 * The hero ledger page: a sample "Day Book" of cash-on-delivery orders. Every name, city and amount is made up and the
 * page says so. New entries are written in every few seconds to show the admin at work.
 */
interface Entry {
  id: string;
  folio: number;
  date: string;
  who: string;
  rupees: number;
}

const FEED: Omit<Entry, "id" | "folio">[] = [
  { date: "04 Oct", who: "Ananya R., Pune", rupees: 1249 },
  { date: "04 Oct", who: "Kabir S., Jaipur", rupees: 899 },
  { date: "03 Oct", who: "Meera D., Guwahati", rupees: 2450 },
  { date: "03 Oct", who: "Rohan P., Indore", rupees: 649 },
  { date: "04 Oct", who: "Isha T., Kochi", rupees: 1799 },
  { date: "04 Oct", who: "Vikram N., Surat", rupees: 1099 },
  { date: "05 Oct", who: "Sana K., Lucknow", rupees: 3250 },
  { date: "05 Oct", who: "Dev M., Nagpur", rupees: 749 },
];

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");

function seed(): Entry[] {
  return FEED.slice(0, 4).map((e, i) => ({ ...e, id: `s${i}`, folio: 115 + (3 - i) }));
}

export function LedgerDayBook() {
  const [rows, setRows] = useState<Entry[]>(seed);
  const [fresh, setFresh] = useState<string | null>(null);
  const next = useRef({ i: 4, folio: 119 });

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const n = next.current;
      const base = FEED[n.i % FEED.length] ?? FEED[0];
      if (!base) return;
      const entry: Entry = { ...base, id: `n${n.i}`, folio: n.folio };
      next.current = { i: n.i + 1, folio: n.folio + 1 };
      setRows((r) => [entry, ...r].slice(0, 4));
      setFresh(entry.id);
    }, 4600);
    return () => window.clearInterval(timer);
  }, []);

  const total = rows.reduce((sum, r) => sum + r.rupees, 0);
  const shownTotal = useSpringNumber(total);

  return (
    <div
      className="bk-paper bk-corners relative w-full max-w-[34rem] self-start"
      role="img"
      aria-label="Sample day book page with made-up cash on delivery orders"
      style={{ transform: "rotate(1deg)" }}
    >
      {/* Folio column header and title: each block is whole ruled lines tall so rows sit on the rules. */}
      <div className="bk-in flex items-center justify-between" style={{ height: "calc(var(--bk-line) * 2)" }}>
        <p className="bk-display text-xl">Day Book <span className="bk-pen text-base" style={{ color: "var(--bk-ink-soft)" }}>· cash on delivery</span></p>
        <span className="bk-pen rounded px-2 text-sm font-bold" style={{ background: "var(--bk-ink)", color: "var(--bk-paper)" }}>Sample data</span>
      </div>
      <div className="bk-in grid grid-cols-[4.4rem_1fr_5.6rem] text-[0.78rem] font-semibold uppercase tracking-wider" style={{ height: "var(--bk-line)", lineHeight: "var(--bk-line)", color: "var(--bk-ink-soft)" }}>
        <span>Date</span><span>Particulars</span><span className="text-right">Amount ₹</span>
      </div>

      <ul aria-hidden="true">
        {rows.map((r, i) => (
          <li
            key={r.id}
            className={`bk-in relative grid grid-cols-[4.4rem_1fr_5.6rem] ${r.id === fresh ? "bk-row-new" : ""}`}
            style={{ height: "var(--bk-line)", lineHeight: "var(--bk-line)" }}
          >
            <span className="bk-num absolute left-0 w-[calc(var(--bk-m)-0.55rem)] text-right text-[0.78rem]" style={{ color: "var(--bk-margin)" }}>{r.folio}</span>
            <span className="bk-pen text-[1.05rem]">
              <span className={r.id.startsWith("s") ? "bk-written" : undefined} style={{ ["--d" as string]: `${400 + i * 260}ms` } as React.CSSProperties}>{r.date}</span>
            </span>
            <span className="bk-pen truncate text-[1.05rem]">
              <span className={r.id.startsWith("s") ? "bk-written" : undefined} style={{ ["--d" as string]: `${520 + i * 260}ms` } as React.CSSProperties}>{r.who}</span>
            </span>
            <span className="bk-num text-right text-[1.02rem] font-semibold">{inr(r.rupees)}</span>
          </li>
        ))}
      </ul>

      <div className="bk-in flex items-center justify-between" style={{ height: "calc(var(--bk-line) * 2)", lineHeight: "var(--bk-line)" }}>
        <span className="bk-pen text-[1.05rem]">Carried forward</span>
        <span className="bk-num border-y-2 px-2 text-xl font-bold" style={{ borderColor: "var(--bk-ink)", fontFamily: "var(--bk-display)", lineHeight: "1.5", borderStyle: "double", borderTopWidth: 0 }}>₹ {inr(shownTotal)}</span>
      </div>
      <div style={{ height: "var(--bk-line)" }} />

      {/* The rubber stamp thumps onto the page once. */}
      <div
        className="bk-stamp pointer-events-none absolute -bottom-6 right-5 flex h-[5.2rem] w-[5.2rem] items-center justify-center rounded-full text-center"
        style={{ border: "3px double #a3211b", color: "#a3211b", background: "rgb(163 33 27 / 0.06)", mixBlendMode: "multiply" }}
        aria-hidden="true"
      >
        <span className="bk-display text-[0.86rem] leading-tight">CASH<br />ON<br />DELIVERY</span>
      </div>
    </div>
  );
}
