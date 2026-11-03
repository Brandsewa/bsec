"use client";

import Link from "next/link";
import { useState } from "react";
import { INCLUDED_IN_ALL, planBullets, type LandingPlan } from "../landing/content.ts";
import { CheckIcon } from "./icons.tsx";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** `bare` drops the section heading (the pricing page has its own header). */
export function HomePricing({ plans, bare = false, heading = "Plans you can read in one go.", description = "Prices in rupees, plus GST. Every plan starts with a 14-day free trial." }: { plans: LandingPlan[]; bare?: boolean; heading?: string; description?: string }) {
  const [interval, setInterval_] = useState<"monthly" | "yearly">("monthly");
  return (
    <section className={bare ? "sec bare" : "sec"} id="pricing">
      <div className="wrap">
        <div className="head center rv">
          {!bare && (
            <>
              <span className="kick">Pricing</span>
              <h2>{heading}</h2>
              <p>{description}</p>
            </>
          )}
          <div className="seg" role="group" aria-label="Billing period">
            {(["monthly", "yearly"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={interval === v} onClick={() => setInterval_(v)}>
                {v === "monthly" ? "Monthly" : "Yearly"}
              </button>
            ))}
          </div>
        </div>
        <div className="joined plans rv">
          {plans.map((p) => {
            const perMonth = interval === "monthly" ? p.monthlyPaise : p.yearlyPaise / 12;
            const saving = p.monthlyPaise * 12 - p.yearlyPaise;
            const hot = p.code === "growth";
            return (
              <div key={p.code} className="plan">
                <h3>{p.name}{hot && <span className="tag">Popular</span>}</h3>
                <div className="price">{inr(perMonth)}<small>/month</small></div>
                <p className="bill">
                  {interval === "yearly" ? `Billed ${inr(p.yearlyPaise)} a year${saving > 0 ? ` · you save ${inr(saving)}` : ""}` : "Billed monthly"}
                </p>
                <Link className={`btn wide ${hot ? "pri" : ""}`} href={`/signup?plan=${p.code}&interval=${interval}`}>Start free trial</Link>
                <ul className="checks">
                  {planBullets(p.limits).map((b) => (
                    <li key={b}><CheckIcon size={15} />{b}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="incl rv">
          <span className="kick">On every plan</span>
          <ul className="checks">
            {INCLUDED_IN_ALL.map((x) => (
              <li key={x}><CheckIcon size={15} />{x}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
