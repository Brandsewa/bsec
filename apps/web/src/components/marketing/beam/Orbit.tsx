"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../landing/motion.ts";

/**
 * The module orbit: a small solar system (three tilted orbits, eight modules as planets) around the store.
 * Planets drift slowly; hovering, focusing or tapping one freezes the whole system and opens a detail card.
 * Each card says only what a merchant can do today (apps/web/PRODUCT.md): what is not live is marked Coming soon.
 * Positions are written straight to the DOM each frame (no React state per frame); under reduced motion the planets
 * are placed once and stay still, and the cards still work.
 */
type Status = "live" | "partial" | "soon";

interface Mod {
  id: string;
  name: string;
  ring: 0 | 1 | 2;
  status: Status;
  tint: string;
  tagline: string;
  today: string[];
  soon?: string[];
}

const MODULES: Mod[] = [
  {
    id: "orders", name: "Orders", ring: 0, status: "live", tint: "#8f8dff",
    tagline: "From the first cash-on-delivery order to the return.",
    today: ["Order board: placed, confirmed, shipped, delivered", "Returns and exchanges", "Quotes and pre-orders", "Abandoned-checkout tracking"],
  },
  {
    id: "inventory", name: "Inventory", ring: 0, status: "live", tint: "#7fd6c2",
    tagline: "Know what you have, and where it is.",
    today: ["Products with variants", "Categories, collections and brands", "Stock by location", "Stock held at order, released on cancel"],
  },
  {
    id: "customers", name: "Customers", ring: 1, status: "live", tint: "#b48dff",
    tagline: "Your buyers, grouped and respected.",
    today: ["Customer profiles and order history", "Segments such as win-back", "Import and export", "Marketing consent recorded"],
  },
  {
    id: "sales", name: "Sales", ring: 1, status: "live", tint: "#6fb6ff",
    tagline: "The storefront that takes the order.",
    today: ["Themed storefront with a visual block editor", "Cash on delivery with a per-store fee", "Discounts", "Reviews with moderation"],
  },
  {
    id: "finance", name: "Finance", ring: 1, status: "partial", tint: "#ffc58d",
    tagline: "GST handled where the order is made.",
    today: ["GST tax invoices with place of supply", "COD fee recorded per order", "Plan pricing in rupees, plus GST"],
    soon: ["Invoice PDF download"],
  },
  {
    id: "shipping", name: "Shipping", ring: 2, status: "partial", tint: "#7fd6c2",
    tagline: "Your zones and your rates, not ours.",
    today: ["Shipping zones per store", "Rates you set per zone", "Mark orders shipped and delivered"],
    soon: ["Shiprocket labels and tracking"],
  },
  {
    id: "payments", name: "Payments", ring: 2, status: "soon", tint: "#8f8dff",
    tagline: "Online payments are on the way.",
    today: ["Today: cash on delivery, with a fee you control"],
    soon: ["Razorpay and UPI checkout"],
  },
  {
    id: "support", name: "Support", ring: 2, status: "partial", tint: "#ff9bb0",
    tagline: "Fix it after the sale.",
    today: ["Returns and exchanges", "Review moderation", "Staff roles and an activity log"],
    soon: ["WhatsApp and SMS updates"],
  },
];

const STATUS_LABEL: Record<Status, string> = { live: "Live", partial: "Live, more coming", soon: "Coming soon" };
const STATUS_COLOR: Record<Status, string> = { live: "#5eead4", partial: "#fbbf24", soon: "#9ea4bd" };

// Orbit size relative to the outermost one, and seconds for one lap (slow on purpose).
const RING_SCALE = [0.4, 0.69, 0.98] as const;
const RING_SECONDS = [80, 120, 170] as const;
const TILT = (-6 * Math.PI) / 180; // the whole system leans: right side up
const PAD = 30; // keeps the outer planets and their labels inside the stage

/** Outer orbit half-height, leaving room for the tilt so the planets stay inside the stage. */
const ryOuter = (w: number, h: number) => Math.max(20, h / 2 - PAD - (w / 2 - PAD) * Math.sin(Math.abs(TILT)));

/** Even spacing within a ring, each ring rotated so the planets do not line up. */
function phaseOf(mod: Mod): number {
  const same = MODULES.filter((m) => m.ring === mod.ring);
  const i = same.findIndex((m) => m.id === mod.id);
  return mod.ring * 1.1 + 0.5 + (i * Math.PI * 2) / same.length;
}

/** Routes the sparks travel: an order or a transaction moving from one module to the next. */
const ROUTES: [string, string][] = [
  ["sales", "orders"], ["customers", "sales"], ["orders", "inventory"], ["orders", "shipping"],
  ["orders", "finance"], ["shipping", "customers"], ["support", "customers"], ["inventory", "sales"], ["finance", "customers"],
];
const ROUTE_IDX = ROUTES.map(([a, b]) => [MODULES.findIndex((m) => m.id === a), MODULES.findIndex((m) => m.id === b)] as const);
const SPARKS = 3; // at most this many in flight
const TAIL = 7; // head plus trailing dots

interface Slot { active: boolean; from: number; to: number; start: number; dur: number; bend: number; next: number }

interface Open { id: string; x: number; y: number; half: number }

export function Orbit() {
  const stageRef = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const pos = useRef<{ x: number; y: number }[]>(MODULES.map(() => ({ x: 0, y: 0 })));
  const size = useRef({ w: 0, h: 0 });
  const frozen = useRef(false);
  const lastType = useRef("mouse");
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  const slots = useRef<Slot[]>(Array.from({ length: SPARKS }, (_, i) => ({ active: false, from: 0, to: 0, start: 0, dur: 2, bend: 0.2, next: 1 + i * 1.3 })));
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [open, setOpen] = useState<Open | null>(null);

  const place = useCallback((t: number) => {
    const { w, h } = size.current;
    if (!w) return;
    const cx = w / 2;
    const cy = h / 2;
    MODULES.forEach((m, i) => {
      const el = els.current[i];
      if (!el) return;
      const k = RING_SCALE[m.ring] ?? 1;
      const rx = (w / 2 - PAD) * k;
      const ry = ryOuter(w, h) * k;
      const a = phaseOf(m) + (Math.PI * 2 * t) / (RING_SECONDS[m.ring] ?? 100);
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      const x = cx + ex * Math.cos(TILT) - ey * Math.sin(TILT);
      const y = cy + ex * Math.sin(TILT) + ey * Math.cos(TILT);
      const depth = (Math.sin(a) + 1) / 2; // 1 at the front (bottom of the ellipse)
      const half = el.offsetWidth / 2;
      const p = pos.current[i];
      if (p) { p.x = x; p.y = y; }
      el.style.transform = `translate3d(${(x - half).toFixed(1)}px, ${(y - half).toFixed(1)}px, 0) scale(${(0.8 + 0.3 * depth).toFixed(3)})`;
      el.style.zIndex = String(1 + Math.round(depth * 10));
      el.style.opacity = String((0.72 + 0.28 * depth).toFixed(2));
    });
  }, []);

  /** Advance the sparks: each one rides a curve between two planets, following them as they drift. */
  const sparks = useCallback((t: number) => {
    slots.current.forEach((s, k) => {
      if (!s.active && t >= s.next) {
        const busy = slots.current.filter((o) => o.active).map((o) => o.from + "-" + o.to);
        const options = ROUTE_IDX.filter(([a, b]) => !busy.includes(a + "-" + b));
        const pick = options[Math.floor(Math.random() * options.length)];
        if (pick) {
          s.active = true; s.from = pick[0]; s.to = pick[1]; s.start = t;
          s.dur = 2.2 + Math.random() * 1.4; s.bend = (Math.random() < 0.5 ? -1 : 1) * (0.16 + Math.random() * 0.14);
        }
      }
      const a = pos.current[s.from];
      const b = pos.current[s.to];
      for (let j = 0; j < TAIL; j++) {
        const el = dots.current[k * TAIL + j];
        if (!el) continue;
        const u = s.active ? (t - s.start) / s.dur - j * 0.022 : -1;
        if (!a || !b || u < 0 || u > 1) { el.style.opacity = "0"; continue; }
        const ease = u * u * (3 - 2 * u);
        const mx = (a.x + b.x) / 2 - (b.y - a.y) * s.bend;
        const my = (a.y + b.y) / 2 + (b.x - a.x) * s.bend;
        const x = (1 - ease) * (1 - ease) * a.x + 2 * (1 - ease) * ease * mx + ease * ease * b.x;
        const y = (1 - ease) * (1 - ease) * a.y + 2 * (1 - ease) * ease * my + ease * ease * b.y;
        const fade = Math.min(1, u * 8, (1 - u) * 8);
        el.style.transform = "translate3d(" + (x - 3).toFixed(1) + "px," + (y - 3).toFixed(1) + "px,0) scale(" + (1 - j / TAIL * 0.7).toFixed(2) + ")";
        el.style.opacity = (fade * (1 - j / TAIL)).toFixed(2);
      }
      if (s.active && (t - s.start) / s.dur > 1.12) { s.active = false; s.next = t + 0.3 + Math.random() * 1.6; }
    });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduced = prefersReducedMotion();
    let raf = 0;
    let t = 6; // start a little way in so the first frame is not the symmetric starting pose
    let last = performance.now();
    let visible = true;

    const measure = () => {
      const r = stage.getBoundingClientRect();
      size.current = { w: r.width, h: r.height };
      setDims({ w: r.width, h: r.height });
      place(t);
    };
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!frozen.current && visible) {
        t += dt;
        place(t);
        sparks(t);
      }
      raf = requestAnimationFrame(frame);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) visible = e.isIntersecting;
    });
    io.observe(stage);
    if (!reduced) raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [place, sparks]);

  const show = useCallback((i: number) => {
    const m = MODULES[i];
    const p = pos.current[i];
    const el = els.current[i];
    if (!m || !p) return;
    frozen.current = true;
    setOpen({ id: m.id, x: p.x, y: p.y, half: (el?.offsetWidth ?? 48) / 2 });
  }, []);
  const hide = useCallback(() => {
    frozen.current = false;
    setOpen(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && !stageRef.current?.contains(e.target as Node)) hide();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, hide]);

  const active = open ? MODULES.find((m) => m.id === open.id) : undefined;
  const cardW = Math.min(320, Math.max(220, dims.w - 16));
  const cardX = open ? Math.min(Math.max(open.x, cardW / 2 + 8), dims.w - cardW / 2 - 8) : 0;
  const above = open ? open.y > dims.h * 0.45 : false;

  return (
    <div ref={stageRef} className="bm-orbit" onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(); }}>
      {/* the orbits */}
      <svg className="bm-orbit-rings" viewBox={`0 0 ${dims.w || 1} ${dims.h || 1}`} aria-hidden="true">
        {RING_SCALE.map((k, i) => (
          <ellipse
            key={k}
            cx={dims.w / 2}
            cy={dims.h / 2}
            rx={Math.max(0, (dims.w / 2 - PAD) * k)}
            ry={Math.max(0, ryOuter(dims.w, dims.h) * k)}
            transform={`rotate(${(TILT * 180) / Math.PI} ${dims.w / 2} ${dims.h / 2})`}
            fill="none"
            stroke="rgb(190 200 255)"
            strokeOpacity={0.2}
            strokeDasharray={i === 2 ? "1 6" : undefined}
            strokeLinecap="round"
          />
        ))}
      </svg>

      {/* sparks: orders and transactions moving between modules */}
      {Array.from({ length: SPARKS * TAIL }, (_, i) => (
        <span key={i} ref={(el) => { dots.current[i] = el; }} className="bm-spark" aria-hidden="true" />
      ))}

      {/* the store at the centre */}
      <div className="bm-sun" aria-hidden="true">
        <span className="bm-sun-ring" />
        <span className="bm-sun-core" />
      </div>

      {MODULES.map((m, i) => (
        <button
          key={m.id}
          ref={(el) => { els.current[i] = el; }}
          type="button"
          className="bm-planet"
          aria-label={`${m.name}: ${STATUS_LABEL[m.status]}`}
          aria-expanded={open?.id === m.id}
          style={{ ["--tint" as string]: m.tint } as React.CSSProperties}
          onPointerDown={(e) => { lastType.current = e.pointerType; }}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") show(i); }}
          onFocus={(e) => { if (e.currentTarget.matches(":focus-visible")) show(i); }}
          onBlur={hide}
          onClick={() => {
            // a mouse already opened it on hover; a tap or press toggles it
            if (lastType.current === "mouse") show(i);
            else if (open?.id === m.id) hide();
            else show(i);
          }}
        >
          <span className={`bm-planet-orb${m.status === "soon" ? " is-soon" : ""}`}>
          </span>
          <span className="bm-planet-label">{m.name}</span>
        </button>
      ))}

      {/* the detail card: informational only, so it never takes the pointer from the planet */}
      {open && active && (
        <div
          className="bm-orbit-card"
          role="status"
          style={{
            width: cardW,
            left: cardX,
            top: above ? open.y - open.half - 14 : open.y + open.half + 30,
            transform: `translate(-50%, ${above ? "-100%" : "0"})`,
          }}
        >
          <div className="flex items-center gap-3">
            <span className="bm-card-chip" style={{ ["--tint" as string]: active.tint } as React.CSSProperties}>
            </span>
            <div className="min-w-0">
              <p className="text-[1.05rem] font-semibold leading-tight">{active.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.08em]" style={{ color: STATUS_COLOR[active.status] }}>
                <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[active.status] }} />
                {STATUS_LABEL[active.status]}
              </p>
            </div>
          </div>
          <p className="bm-dim mt-3 text-[0.88rem] leading-snug">{active.tagline}</p>
          <ul className="mt-3 space-y-1.5 text-[0.86rem] leading-snug">
            {active.today.map((t) => (
              <li key={t} className="flex gap-2"><span aria-hidden="true" style={{ color: "#5eead4" }}>✓</span><span>{t}</span></li>
            ))}
          </ul>
          {active.soon && (
            <ul className="mt-2.5 space-y-1.5 border-t pt-2.5 text-[0.84rem] leading-snug" style={{ borderColor: "var(--bm-line)", color: "var(--bm-dim)" }}>
              {active.soon.map((t) => (
                <li key={t} className="flex gap-2"><span aria-hidden="true">◌</span><span>{t} <b className="font-semibold" style={{ color: "#fbbf24" }}>· Coming soon</b></span></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
