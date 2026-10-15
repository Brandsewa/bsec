"use client";

import React, { useEffect, useState } from "react";

interface Estimate {
  arrives: string;
  countdown: string;
}

/** Day, hour and minute in a time zone, read with Intl so it follows the store's clock, not the shopper's. */
function partsIn(timeZone: string, date: Date): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/**
 * Works out the estimate for a moment: orders before the cut-off hour (store time) ship that day, later ones the next day;
 * delivery is dispatch day plus the transit days, never on a Sunday. Exported for tests.
 */
export function estimateDelivery(now: Date, cutoffHour: number, deliveryDays: number, timeZone: string): Estimate {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
  } catch {
    tz = "Asia/Kolkata";
  }
  const p = partsIn(tz, now);
  const minutesNow = p.h * 60 + p.min;
  const cutoff = cutoffHour * 60;
  const beforeCutoff = minutesNow < cutoff;
  const minutesLeft = beforeCutoff ? cutoff - minutesNow : 24 * 60 - minutesNow + cutoff;
  // Work in UTC calendar days so a daylight-saving change in the shopper's own zone cannot shift the date.
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d));
  if (!beforeCutoff) day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
  let remaining = deliveryDays;
  while (remaining > 0) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (day.getUTCDay() !== 0) remaining -= 1;
  }
  const arrives = day.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  const h = Math.floor(minutesLeft / 60);
  const m = minutesLeft % 60;
  const countdown = h > 0 ? `${h} ${h === 1 ? "hr" : "hrs"}${m > 0 ? ` ${m} ${m === 1 ? "min" : "mins"}` : ""}` : `${m} ${m === 1 ? "min" : "mins"}`;
  return { arrives, countdown };
}

/**
 * "Arrives Thu 22 Oct if you order in the next 6 hrs 12 mins. Ships within 24 hrs." It is a guide, not a promise, and is
 * worked out in the browser so a cached page never shows yesterday's date.
 */
export function DeliveryEstimate({ cutoffHour, deliveryDays, shipsText, timeZone }: { cutoffHour: number; deliveryDays: number; shipsText: string; timeZone: string }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  useEffect(() => {
    const compute = () => setEstimate(estimateDelivery(new Date(), cutoffHour, deliveryDays, timeZone));
    compute();
    const id = window.setInterval(compute, 60_000);
    return () => window.clearInterval(id);
  }, [cutoffHour, deliveryDays, timeZone]);

  if (!estimate) return <div aria-hidden className="h-5" />;

  return (
    <p className="flex items-start gap-2 text-sm text-foreground" data-testid="delivery-estimate">
      <svg aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
        <circle cx="17" cy="18" r="2" />
        <circle cx="7" cy="18" r="2" />
      </svg>
      <span>
        Arrives <strong>{estimate.arrives}</strong> if you order in the next <strong>{estimate.countdown}</strong>.{shipsText ? ` ${shipsText}.` : ""}
      </span>
    </p>
  );
}
