"use client";

import Link from "next/link";
import { useState } from "react";
import { INCLUDED_IN_ALL, planBullets, type LandingPlan } from "../content.ts";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** `bare` drops the section heading (the pricing page has its own header). */
export function Pricing({ plans, bare = false }: { plans: LandingPlan[]; bare?: boolean }) {
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");
  return (
    <section className={bare ? "sec doc-pricing" : "sec"} id="pricing">
      <div className="wrap">
        <div className="rv" style={{ textAlign: "center" }}>
          {!bare && (
            <>
              <span className="eyebrow">Pricing</span>
              <h2>Plans you can read <i className="s gt">in one go.</i></h2>
              <p className="lead" style={{ marginInline: "auto" }}>Prices in rupees, plus GST. Every plan starts with a 14-day free trial.</p>
            </>
          )}
          <div className="seg" role="group" aria-label="Billing period" style={{ marginTop: bare ? 0 : 26 }}>
            {(["monthly", "yearly"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={interval === v} onClick={() => setInterval_(v)}>
                {v === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
        <div className="plans">
          {plans.map((p, i) => {
            const perMonth = interval === "monthly" ? p.monthlyPaise : p.yearlyPaise / 12;
            const saving = p.monthlyPaise * 12 - p.yearlyPaise;
            const hot = p.code === "growth";
            return (
              <div key={p.code} className={`spot plan rv ${hot ? "hot" : ""} ${i === 1 ? "d1" : i === 2 ? "d2" : ""}`}>
                <h3>
                  {p.name}
                  {hot && <span className="pill am"><b />Popular</span>}
                </h3>
                <div className="price">{inr(perMonth)}<small> /month</small></div>
                <div className="sub">
                  {interval === "yearly" ? `Billed ${inr(p.yearlyPaise)} a year${saving > 0 ? ` · you save ${inr(saving)}` : ""}` : "Billed monthly"}
                </div>
                <ul>
                  {planBullets(p.limits).map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                <Link className={`btn ${hot ? "pri" : ""}`} href={`/signup?plan=${p.code}&interval=${interval}`}>
                  Start free trial
                </Link>
              </div>
            );
          })}
        </div>
        <ul className="incl rv" style={{ listStyle: "none" }}>
          {INCLUDED_IN_ALL.map((x, i) => (
            <li key={x} className={i === 0 ? "hi" : ""} style={{ fontSize: 13.5 }}>{x}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
