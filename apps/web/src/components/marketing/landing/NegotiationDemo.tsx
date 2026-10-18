"use client";

/*
 * "Your AI sales rep": the visitor moves the order size and the store's maximum discount, and the scripted store
 * replies change with the rules. Illustration only; the numbers are made up.
 */

import { useId, useState } from "react";
import { NEGOTIATION, bundleDiscount } from "./demo-data.ts";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function NegotiationControls({
  quantity,
  onQuantity,
  max,
  onMax,
}: {
  quantity: number;
  onQuantity: (n: number) => void;
  max: number;
  onMax: (n: number) => void;
}) {
  const id = useId();
  return (
    <div className="ctl">
      <div>
        <label htmlFor={`${id}-qty`}>
          Pieces in the order <b>{quantity}</b>
        </label>
        <input id={`${id}-qty`} type="range" min={1} max={40} value={quantity} onChange={(e) => onQuantity(Number(e.target.value))} />
      </div>
      <div>
        <label id={`${id}-max`}>Your maximum discount</label>
        <div className="opts" role="group" aria-labelledby={`${id}-max`}>
          {NEGOTIATION.maxChoices.map((c) => (
            <button key={c} type="button" className={max === c ? "on" : ""} aria-pressed={max === c} onClick={() => onMax(c)}>
              {c}%
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NegotiationChat({ quantity, max }: { quantity: number; max: number }) {
  const tier = bundleDiscount(quantity);
  const off = Math.min(tier, max);
  const unit = NEGOTIATION.unitPrice;
  const accepted = max >= NEGOTIATION.buyerAsks && quantity >= 12;
  return (
    <>
      <div className="chat" style={{ minHeight: 300 }} aria-live="polite">
        <div className="m u">
          Buying {quantity} hoodie{quantity > 1 ? "s" : ""}. Any discount?
        </div>
        {quantity < 5 ? (
          <div className="m b">
            <small>Your store</small>
            Single pieces are priced firm at {inr(unit)}. Add 5 or more to unlock a bundle price.
          </div>
        ) : (
          <>
            <div className="m b">
              <small>Your store</small>
              For {quantity} pieces I can do <b>{off}% off</b>: {inr(quantity * unit * (1 - off / 100))} total.
            </div>
            <div className="m u">Can you do {NEGOTIATION.buyerAsks}%?</div>
            {accepted ? (
              <div className="m b">
                <small>Your store</small>
                Done. <b>{NEGOTIATION.buyerAsks}% off</b>: {inr(quantity * unit * (1 - NEGOTIATION.buyerAsks / 100))} total.
              </div>
            ) : (
              <div className="m b">
                <small>Your store</small>
                {off}% is my best offer at this size.
              </div>
            )}
          </>
        )}
      </div>
      <div className="rule">
        <b>Your rules:</b> bundle discounts start at 5 pieces, never more than {max}%.
      </div>
    </>
  );
}

/** Controls and chat share state, so they live in one client component. */
export function NegotiationDemo() {
  const [quantity, setQuantity] = useState(12);
  const [max, setMax] = useState(10);
  return (
    <div className="negg">
      <div className="rv">
        <span className="eyebrow">Your AI sales rep</span>
        <h2>
          A sales rep that <i className="s gt">never sleeps.</i>
        </h2>
        <p className="lead">When a buyer&rsquo;s assistant asks for a deal, your store answers inside the limits you set. Try the rules.</p>
        <NegotiationControls quantity={quantity} onQuantity={setQuantity} max={max} onMax={setMax} />
      </div>
      <div className="win rv d1">
        <div className="wbar">
          <span className="dots"><i /><i /><i /></span>
          <span className="wtag" style={{ marginLeft: 0 }}>Buyer&rsquo;s assistant ⇄ Your store · Illustration</span>
        </div>
        <NegotiationChat quantity={quantity} max={max} />
      </div>
    </div>
  );
}
