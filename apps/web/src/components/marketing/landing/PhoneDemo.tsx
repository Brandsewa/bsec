"use client";

/*
 * Hero phone: a scripted shopping conversation (illustration, labelled as such).
 * A shopper types a search, three brands come back, one is chosen, paid for and confirmed with a push notification.
 * The animation only runs while the phone is on screen and the tab is visible; reduced motion shows the finished state.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatGptIcon, ClaudeIcon, GeminiIcon, StarIcon } from "./BrandIcons.tsx";
import { DEMO_ORDER_NUMBER, DEMO_SEARCHES, searchAt, type DemoProduct } from "./demo-data.ts";

type PickState = "none" | "sel" | "out";
type PayState = "idle" | "press" | "processing" | "paid";

interface View {
  text: string;
  typing: boolean;
  press: boolean;
  user: boolean;
  waiting: boolean;
  results: boolean;
  pay: boolean;
  done: boolean;
  pick: PickState;
  payState: PayState;
  notif: boolean;
}

const EMPTY: View = { text: "", typing: false, press: false, user: false, waiting: false, results: false, pay: false, done: false, pick: "none", payState: "idle", notif: false };
const FINAL: View = { ...EMPTY, user: true, results: true, pay: true, done: true, pick: "out", payState: "paid" };

const ICONS = { ChatGPT: ChatGptIcon, Gemini: GeminiIcon, Claude: ClaudeIcon } as const;

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const subscribeVisible = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};

function ProductCard({ p, k, className }: { p: DemoProduct; k: number; className: string }) {
  return (
    <div className={`pc2 ${className}`} style={{ ["--g1" as string]: p.gradient, ["--k" as string]: k } as React.CSSProperties}>
      <div className="im" />
      <div className="bd">
        <div className="nm">{p.name}</div>
        <div className="rt">
          <span className="bn">{p.brand}</span>
          <span className="sr-star"><StarIcon /></span>
          {p.rating} <span>({p.reviews})</span>
        </div>
        <div className="pr"><b>{p.price}</b><span className="dl">{p.delivery}</span></div>
      </div>
    </div>
  );
}

export function PhoneDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(0);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(true);
  const [view, setView] = useState<View>(EMPTY);

  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const pageVisible = useSyncExternalStore(subscribeVisible, () => document.visibilityState === "visible", () => true);
  const active = inView && pageVisible && !reduced;

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => setInView(es[0]?.isIntersecting ?? true), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    const x = searchAt(tab);
    const timers: number[] = [];
    const at = (ms: number, patch: Partial<View>) => {
      timers.push(window.setTimeout(() => setView((v) => ({ ...v, ...patch })), ms));
    };
    const n = x.query.length;
    const t0 = 700;
    const step = 55;
    const te = t0 + n * step;
    at(0, EMPTY);
    for (let k = 1; k <= n; k++) at(t0 + k * step, { text: x.query.slice(0, k), typing: true });
    at(te + 350, { text: x.query, typing: false, press: true });
    at(te + 800, { press: false, text: "", user: true });
    at(te + 1400, { waiting: true });
    at(te + 2600, { waiting: false, results: true });
    at(te + 4700, { pick: "sel" });
    at(te + 5600, { pick: "out" });
    at(te + 6500, { pay: true });
    at(te + 8000, { payState: "press" });
    at(te + 8400, { payState: "processing" });
    at(te + 10000, { payState: "paid", done: true });
    at(te + 10900, { notif: true });
    at(te + 14900, { notif: false });
    if (auto) timers.push(window.setTimeout(() => setTab((t) => (t + 1) % DEMO_SEARCHES.length), te + 16400));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [active, tab, auto]);

  const v = reduced ? FINAL : view;
  const x = searchAt(tab);
  const chosen = x.products[x.pick];

  return (
    <div className="stage" ref={rootRef}>
      <div className="phone">
        <div className="isl" />
        <div className="sbar"><span>9:41</span><span className="wtag">Illustration</span></div>
        <div className="tabs" role="tablist" aria-label="AI assistants">
          {DEMO_SEARCHES.map((s, i) => {
            const Icon = ICONS[s.assistant];
            return (
              <button
                key={s.assistant}
                type="button"
                role="tab"
                aria-selected={tab === i}
                className={`tab ${tab === i ? "on" : ""}`}
                onClick={() => {
                  setAuto(false);
                  setTab(i);
                }}
              >
                <Icon />
                {s.assistant}
              </button>
            );
          })}
        </div>

        <div className="chat" aria-hidden="true">
          {v.user && <div className="m u">{x.query}</div>}
          {v.waiting && <div className="m b typing"><i /><i /><i /></div>}
          {v.results && (
            <div className="m b">
              <small>{x.matched}</small>
              {x.intro}
              {x.products.map((p, k) => (
                <ProductCard key={p.brand} p={p} k={k} className={v.pick === "none" ? "" : k === x.pick ? "sel" : v.pick === "out" ? "dim out" : "dim"} />
              ))}
            </div>
          )}
          {v.pay && (
            <div className="m b">
              <small>Ready · price locked</small>
              Great choice. {chosen.brand} holds this price for 10 minutes.
              <div className="acts">
                <span className={`p wide ${v.payState === "press" ? "press" : ""} ${v.payState === "paid" ? "paid" : ""}`}>
                  {v.payState === "processing" ? (<><i className="sp" />Processing payment</>) : v.payState === "paid" ? "Paid ✓" : "Pay now"}
                </span>
              </div>
            </div>
          )}
          {v.done && (
            <div className="m b">
              <div className="done">
                <svg className="ck" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" /><path d="M10.5 16.5l4 4 7-8" /></svg>
                <div><b>Order placed</b><span className="t">{DEMO_ORDER_NUMBER} · {chosen.name}</span></div>
              </div>
            </div>
          )}
        </div>

        <div className="comp" aria-hidden="true">
          <span className={`${v.text ? "" : "ph"} ${v.typing ? "tc" : ""}`}>{v.text || "Ask anything"}</span>
          <i className={v.press ? "press" : ""}>↑</i>
        </div>

        <div className={`notif ${v.notif ? "show" : ""}`} aria-hidden="true">
          <span className="ni">B</span>
          <div>
            <small>Bs Commerce · now</small>
            <b>Order placed successfully</b>
            <span>{chosen.name} from {chosen.brand} arrives {x.arrives}. We will keep you posted here.</span>
          </div>
        </div>
      </div>
      <p className="sr">
        Illustration: a shopper asks {x.assistant} for &ldquo;{x.query}&rdquo;, sees three products from different brands, picks {chosen.brand}&rsquo;s {chosen.name} at {chosen.price}, pays, and
        gets an order confirmation and a notification.
      </p>
    </div>
  );
}
