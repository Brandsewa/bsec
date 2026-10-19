"use client";

/*
 * Hero phone: three scripted ways a shopper buys (illustration, labelled as such).
 *  - Google Search and Instagram: ready today. The shopper finds the product, opens the store and places a cash-on-delivery order.
 *  - AI agents: coming soon. The assistant chat (search, three brands, pick, pay, confirmation, notification).
 * The animation only runs while the phone is on screen and the tab is visible; reduced motion shows the finished state.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GoogleIcon, InstagramIcon, SearchIcon, SparkIcon, StarIcon } from "./BrandIcons.tsx";
import { DEMO_ORDER_NUMBER, searchAt, type DemoProduct } from "./demo-data.ts";

type Mode = "google" | "instagram" | "agents";
type PickState = "none" | "sel" | "out";
type PayState = "idle" | "press" | "processing" | "paid";

interface View {
  /** Typed text (search bar or composer). */
  text: string;
  typing: boolean;
  press: boolean;
  /** Progress through the Google and Instagram flows (see the timelines below). */
  stage: number;
  /** Agent chat state. */
  user: boolean;
  waiting: boolean;
  results: boolean;
  pay: boolean;
  done: boolean;
  pick: PickState;
  payState: PayState;
  notif: boolean;
}

const EMPTY: View = { text: "", typing: false, press: false, stage: 0, user: false, waiting: false, results: false, pay: false, done: false, pick: "none", payState: "idle", notif: false };
const FINAL: View = { ...EMPTY, stage: 6, user: true, results: true, pay: true, done: true, pick: "out", payState: "paid" };

interface TabInfo { mode: Mode; label: string; ready: boolean; Icon: () => React.ReactElement }
const GOOGLE_TAB: TabInfo = { mode: "google", label: "Google Search", ready: true, Icon: GoogleIcon };
const TABS: TabInfo[] = [
  GOOGLE_TAB,
  { mode: "instagram", label: "Instagram", ready: true, Icon: InstagramIcon },
  { mode: "agents", label: "AI agents", ready: false, Icon: SparkIcon },
];

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

/** The merchant's store page, shared by the Google and Instagram flows. Cash on delivery is what is live today. */
function StorePage({ p, stage }: { p: DemoProduct; stage: number }) {
  const placed = stage >= 6;
  return (
    <div className="spage">
      <div className="surl"><span aria-hidden="true">🔒</span> {p.brand.toLowerCase().replace(/[^a-z0-9]+/g, "")}.bcom.si</div>
      <div className="shero" style={{ background: p.gradient }} />
      <div className="sbody">
        <div className="sname">{p.name}</div>
        <div className="rt"><span className="bn">{p.brand}</span><span className="sr-star"><StarIcon /></span>{p.rating} <span>({p.reviews})</span></div>
        <div className="sprice"><b>{p.price}</b><span>incl. GST</span></div>
        <div className="schips"><span>● In stock</span><span>{p.delivery}</span><span>Cash on delivery</span></div>
        {placed ? (
          <div className="done sdone">
            <svg className="ck" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" /><path d="M10.5 16.5l4 4 7-8" /></svg>
            <div><b>Order placed</b><span className="t">{DEMO_ORDER_NUMBER} · pay {p.price} on delivery</span></div>
          </div>
        ) : (
          <div className={`obtn ${stage === 4 ? "press" : ""}`}>
            {stage === 5 ? (<><i className="sp" />Placing your order</>) : "Order now · Cash on delivery"}
          </div>
        )}
      </div>
    </div>
  );
}

export function PhoneDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(0);
  const [agentRound, setAgentRound] = useState(0);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(true);
  const [view, setView] = useState<View>(EMPTY);

  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
  const pageVisible = useSyncExternalStore(subscribeVisible, () => document.visibilityState === "visible", () => true);
  const active = inView && pageVisible && !reduced;

  const tabInfo = TABS[tab] ?? GOOGLE_TAB;
  const mode = tabInfo.mode;
  const agentSearch = searchAt(agentRound);
  const shopSearch = searchAt(0);
  const x = mode === "agents" ? agentSearch : shopSearch;
  const query = x.query;
  const chosen = x.products[x.pick];
  const shopProduct = shopSearch.products[0];

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => setInView(es[0]?.isIntersecting ?? true), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    const timers: number[] = [];
    const at = (ms: number, patch: Partial<View>) => {
      timers.push(window.setTimeout(() => setView((v) => ({ ...v, ...patch })), ms));
    };
    const next = (ms: number) => {
      if (!auto) return;
      timers.push(
        window.setTimeout(() => {
          if (mode === "agents") setAgentRound((r) => r + 1);
          setTab((t) => (t + 1) % TABS.length);
        }, ms),
      );
    };
    const n = query.length;
    const t0 = 700;
    const step = 55;
    const te = t0 + n * step;
    at(0, EMPTY);

    if (mode === "google") {
      for (let k = 1; k <= n; k++) at(t0 + k * step, { text: query.slice(0, k), typing: true });
      at(te + 350, { typing: false, press: true });
      at(te + 800, { press: false, stage: 1 });
      at(te + 3000, { stage: 2, pick: "sel" });
      at(te + 4200, { stage: 3 });
      at(te + 6000, { stage: 4 });
      at(te + 6400, { stage: 5 });
      at(te + 8000, { stage: 6 });
      next(te + 11500);
    } else if (mode === "instagram") {
      at(500, { stage: 1 });
      at(2600, { stage: 2 });
      at(3500, { stage: 3 });
      at(5300, { stage: 4 });
      at(5700, { stage: 5 });
      at(7300, { stage: 6 });
      next(11000);
    } else {
      for (let k = 1; k <= n; k++) at(t0 + k * step, { text: query.slice(0, k), typing: true });
      at(te + 350, { text: query, typing: false, press: true });
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
      next(te + 16400);
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [active, tab, agentRound, auto, mode, query]);

  const v = reduced ? FINAL : view;

  return (
    <div className="stage" ref={rootRef}>
      <div className="phone">
        <div className="isl" />
        <div className="sbar">
          <span>9:41</span>
          <span className={`tagstat ${tabInfo.ready ? "ok" : "soon"}`}>{tabInfo.ready ? "Ready today" : "Coming soon"}</span>
        </div>
        <div className="tabs" role="tablist" aria-label="Ways to sell">
          {TABS.map((t, i) => (
            <button
              key={t.mode}
              type="button"
              role="tab"
              aria-selected={tab === i}
              className={`tab ${tab === i ? "on" : ""}`}
              onClick={() => {
                setAuto(false);
                setTab(i);
              }}
            >
              <t.Icon />
              {t.label}
            </button>
          ))}
        </div>

        {mode === "google" && (
          <div className="gwrap" aria-hidden="true">
            <div className="gsearch">
              <SearchIcon />
              <span className={`${v.text ? "" : "ph"} ${v.typing ? "tc" : ""}`}>{v.text || "Search"}</span>
              <i className={v.press ? "press" : ""}>→</i>
            </div>
            {v.stage === 0 && <div className="ghint">Shoppers search Google for what they want.</div>}
            {(v.stage === 1 || v.stage === 2) && (
              <div className="gres">
                <div className="cap">Shopping results</div>
                {x.products.map((p, k) => (
                  <ProductCard key={p.brand} p={p} k={k} className={v.pick === "none" ? "" : k === 0 ? "sel" : "dim"} />
                ))}
              </div>
            )}
            {v.stage >= 3 && <StorePage p={x.products[0]} stage={v.stage} />}
          </div>
        )}

        {mode === "instagram" && (
          <div className="gwrap" aria-hidden="true">
            {v.stage < 3 ? (
              <div className="igpost" style={{ opacity: v.stage === 0 ? 0 : 1 }}>
                <div className="igh"><span className="av" /><b>heritage.store</b><small>Winter drop</small></div>
                <div className="igimg" style={{ background: shopProduct.gradient }}>
                  <span className={`igtag ${v.stage === 2 ? "press" : ""}`}>{shopProduct.name} · {shopProduct.price} →</span>
                </div>
                <div className="igact"><span>♡</span><span>💬</span><span>➤</span></div>
                <div className="igcap"><b>heritage.store</b> New winter hoodies are here. Warm, soft and gift-ready. Tap the tag or use the link in our bio.</div>
              </div>
            ) : (
              <StorePage p={shopProduct} stage={v.stage} />
            )}
          </div>
        )}

        {mode === "agents" && (
          <>
            <div className="chat" aria-hidden="true">
              {v.user && <div className="m u">{query}</div>}
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
                <small>BCom · now</small>
                <b>Order placed successfully</b>
                <span>{chosen.name} from {chosen.brand} arrives {x.arrives}.</span>
              </div>
            </div>
          </>
        )}
      </div>
      <p className="phone-note">
        Illustration. {tabInfo.ready ? "Selling through web search and social media works today, with cash on delivery." : "Selling inside AI assistants is coming soon, as each one launches in India."}
      </p>
      <p className="sr">
        Illustration: {mode === "google" && `a shopper searches Google for “${query}”, sees products from different brands, opens the store of the first and places a cash-on-delivery order.`}
        {mode === "instagram" && "a shopper sees a product on Instagram, taps the product tag, opens the store and places a cash-on-delivery order."}
        {mode === "agents" && `a shopper asks an AI assistant for “${query}”, picks one of three products and pays inside the chat. This is coming soon.`}
      </p>
    </div>
  );
}

