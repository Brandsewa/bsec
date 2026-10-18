"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { StarIcon } from "../BrandIcons.tsx";

const STEPS = [
  { t: "Discover", p: "Your products are read, enriched with details and tags, and matched to what shoppers ask for." },
  { t: "Compare", p: "Live price, stock and pincode delivery let an assistant answer honestly before anyone clicks." },
  { t: "Check out", p: "The cart is locked with your price, GST and shipping. UPI and COD, inside the chat." },
  { t: "Track", p: "Order updates flow back into the conversation. You see it all in your usual dashboard." },
];

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

function Panel({ i }: { i: number }) {
  if (i === 0)
    return (
      <>
        <div className="m u">I need a warm hoodie for gifting. Under ₹2,500.</div>
        <div className="m b">
          <small>3 stores matched</small>
          Best match is a wool hoodie, relaxed fit, good for gifting.
          <div className="pc2" style={{ ["--g1" as string]: "linear-gradient(135deg,#f59e0b,#92400e)" } as React.CSSProperties}>
            <div className="im" />
            <div className="bd">
              <div className="nm">Wool Hoodie</div>
              <div className="rt"><span className="bn">Heritage</span><span className="sr-star"><StarIcon /></span>4.8 <span>(212)</span></div>
              <div className="pr"><b>₹2,199</b><span className="dl">Free delivery</span></div>
            </div>
          </div>
        </div>
      </>
    );
  if (i === 1)
    return (
      <>
        <div className="m u">Does it come in grey, and can it reach 411001 by Friday?</div>
        <div className="m b"><small>Live from the store</small>Grey is in S to XL. <span className="ok">Only 4 left in L.</span> Delivers to 411001 by Friday, free shipping.</div>
      </>
    );
  if (i === 2)
    return (
      <>
        <div className="m u">Great. Grey L, pay now.</div>
        <div className="m b"><small>Order locked · 10:00</small>₹2,199 incl. GST, free delivery.<div className="acts"><span className="p wide">Pay now</span></div></div>
      </>
    );
  return (
    <>
      <div className="m b"><small>Order confirmed</small><span className="ok">●</span> Order placed. Shipped today, arriving Friday.</div>
      <div className="m b"><small>Update</small>Out for delivery. I&rsquo;ll message you when it arrives.</div>
    </>
  );
}

export function Journey() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [auto, setAuto] = useState(true);
  const [inView, setInView] = useState(false);
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => setInView(es[0]?.isIntersecting ?? false), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || reduced || !inView) return;
    const t = window.setTimeout(() => {
      setActive((a) => (a + 1) % STEPS.length);
      setCycle((c) => c + 1);
    }, 6000);
    return () => window.clearTimeout(t);
  }, [active, cycle, auto, reduced, inView]);

  const pick = (i: number) => {
    setAuto(false);
    setActive(i);
    setCycle((c) => c + 1);
  };

  return (
    <div className="jr">
      <div className="steps rv" role="tablist" aria-label="Steps of a purchase" aria-orientation="vertical">
        {STEPS.map((s, i) => (
          <button key={s.t} type="button" role="tab" id={`lp-step-${i}`} aria-selected={active === i} aria-controls="lp-step-panel" className={`st ${active === i ? "on" : ""}`} onClick={() => pick(i)}>
            <h3><em>0{i + 1}</em>{s.t}</h3>
            <p>{s.p}</p>
            {active === i && auto && !reduced && <span key={cycle} className="pr" />}
          </button>
        ))}
      </div>
      <div className="win rv d1" ref={rootRef}>
        <div className="wbar"><span className="dots"><i /><i /><i /></span><span className="wtag" style={{ marginLeft: 0 }}>AI assistant · Illustration</span></div>
        <div className="chat" id="lp-step-panel" role="tabpanel" aria-labelledby={`lp-step-${active}`} style={{ minHeight: 340 }}>
          <Panel i={active} />
        </div>
      </div>
    </div>
  );
}
