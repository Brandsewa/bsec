"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { CardIcon, ChartIcon, ChatIcon, ClockIcon, LockIcon, TagIcon } from "./icons.tsx";

const ATTRS: Array<[string, string]> = [["material", "wool blend"], ["fit", "relaxed"], ["occasion", "gifting"], ["season", "winter"], ["HSN", "6110"], ["colour", "grey"]];
const SOURCES: Array<[string, string]> = [["ChatGPT", "78%"], ["Gemini", "56%"], ["Web", "38%"], ["Claude", "24%"]];

interface AiTab {
  key: string;
  label: string;
  tag: string;
  title: string;
  body: string;
  Icon: typeof TagIcon;
  panel: ReactNode;
}

const TABS: AiTab[] = [
  {
    key: "catalog",
    label: "Catalog",
    tag: "Coming soon",
    title: "A catalog assistants can understand",
    body: "Products are read and enriched with material, fit, occasion and tax code, so assistants can match them to real questions.",
    Icon: TagIcon,
    panel: <div className="attrs">{ATTRS.map(([k, v]) => <span key={k}>{k}<b>{v}</b></span>)}</div>,
  },
  {
    key: "price",
    label: "Price lock",
    tag: "Built for the future",
    title: "Prices that can’t be invented",
    body: "Each AI cart is locked for a short window with your price, GST and shipping.",
    Icon: LockIcon,
    panel: (
      <div className="lock">
        <div className="lock-t"><ClockIcon size={16} /><span>Cart locked</span><b>10:00</b></div>
        <div className="kv"><span>Price</span><b>₹2,000</b></div>
        <div className="kv"><span>GST</span><b>₹100</b></div>
        <div className="kv"><span>Shipping</span><b>₹60</b></div>
      </div>
    ),
  },
  {
    key: "pay",
    label: "Pay in chat",
    tag: "Coming soon",
    title: "Pay inside the chat",
    body: "UPI and cards inside the assistant, with cash on delivery always an option.",
    Icon: CardIcon,
    panel: <div className="payopts"><span className="on">UPI</span><span>Cards</span><span>Cash on delivery</span></div>,
  },
  {
    key: "rep",
    label: "AI sales rep",
    tag: "Built for the future",
    title: "An AI sales rep for your store",
    body: "A buyer’s assistant can ask for a bundle price. Your store answers inside the limits you set, for example up to 10% off orders above ₹2,500.",
    Icon: ChatIcon,
    panel: (
      <div className="chat">
        <p className="u">Can you do a better price on these two?</p>
        <p>Yes. 10% off, because the order is above ₹2,500.</p>
      </div>
    ),
  },
  {
    key: "source",
    label: "Attribution",
    tag: "Coming soon",
    title: "See which assistant sold",
    body: "Searches, carts and revenue by source: ChatGPT, Gemini, Claude and web.",
    Icon: ChartIcon,
    panel: (
      <div className="srcs">
        {SOURCES.map(([name, w]) => (
          <div key={name}><span>{name}</span><i><u style={{ width: w }} /></i></div>
        ))}
      </div>
    ),
  },
];

export function AiTabs() {
  const [active, setActive] = useState(0);
  const tab = TABS[active];
  if (!tab) return null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (active + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    setActive(next);
    e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus();
  };

  return (
    <div className="tabs rv">
      <div className="tablist" role="tablist" aria-label="AI shopping features" onKeyDown={onKey}>
        {TABS.map((t, i) => (
          <button key={t.key} id={`ai-tab-${t.key}`} type="button" role="tab" aria-selected={i === active} aria-controls="ai-panel" tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)}>
            <t.Icon size={16} />{t.label}
          </button>
        ))}
      </div>
      <div className="tabpanel" id="ai-panel" role="tabpanel" aria-labelledby={`ai-tab-${tab.key}`}>
        <div className="tab-copy">
          <span className="soon">{tab.tag}</span>
          <h3>{tab.title}</h3>
          <p>{tab.body}</p>
        </div>
        <div className="tab-art" aria-hidden="true">{tab.panel}</div>
      </div>
    </div>
  );
}
