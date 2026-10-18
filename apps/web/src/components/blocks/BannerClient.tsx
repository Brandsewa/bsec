"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * The announcement bar's previous / next arrows. The bar rotates on its own with CSS; the first arrow click picks the message
 * after (or before) the one showing and holds it there (data-ann-i), which stops the rotation. One delegated click handler,
 * no state: the server-rendered bar stays as it is.
 */
export function BannerClient({ children }: { children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>("[data-ann-dir]");
    const bar = button?.closest<HTMLElement>(".bsb-ann");
    if (!button || !bar) return;
    const messages = [...bar.querySelectorAll<HTMLElement>(".bsb-ann-msg")];
    if (messages.length < 2) return;
    // The message showing now: the one that was set last, or else the most visible one.
    let current = bar.dataset.annI !== undefined ? Number(bar.dataset.annI) : -1;
    if (current < 0) {
      let best = 0;
      messages.forEach((m, i) => {
        if (Number(getComputedStyle(m).opacity) > Number(getComputedStyle(messages[best] as HTMLElement).opacity)) best = i;
      });
      current = best;
    }
    const dir = Number(button.dataset.annDir) < 0 ? -1 : 1;
    bar.dataset.annI = String((current + dir + messages.length) % messages.length);
  };
  // display: contents keeps the wrapper out of the layout.
  return (
    <div style={{ display: "contents" }} onClick={onClick}>
      {children}
    </div>
  );
}
