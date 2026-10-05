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
  icon: { d: string } | { glyph: string };
  tagline: string;
  today: string[];
  soon?: string[];
}

const MODULES: Mod[] = [
  {
    id: "orders", name: "Orders", ring: 0, status: "live", tint: "#8f8dff",
    icon: { d: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 3h6v4H9zM9 12h6M9 16h4" },
    tagline: "From the first cash-on-delivery order to the return.",
    today: ["Order board: placed, confirmed, shipped, delivered", "Returns and exchanges", "Quotes and pre-orders", "Abandoned-checkout tracking"],
  },
  {
    id: "inventory", name: "Inventory", ring: 0, status: "live", tint: "#7fd6c2",
    icon: { d: "M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" },
    tagline: "Know what you have, and where it is.",
    today: ["Products with variants", "Categories, collections and brands", "Stock by location", "Stock held at order, released on cancel"],
  },
  {
    id: "customers", name: "Customers", ring: 1, status: "live", tint: "#b48dff",
    icon: { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" },
    tagline: "Your buyers, grouped and respected.",
    today: ["Customer profiles and order history", "Segments such as win-back", "Import and export", "Marketing consent recorded"],
  },
  {
    id: "sales", name: "Sales", ring: 1, status: "live", tint: "#6fb6ff",
    icon: { d: "M3 17l6-6 4 4 8-8M15 7h6v6" },
    tagline: "The storefront that takes the order.",
    today: ["Themed storefront with a visual block editor", "Cash on delivery with a per-store fee", "Discounts", "Reviews with moderation"],
  },
  {
    id: "finance", name: "Finance", ring: 1, status: "partial", tint: "#ffc58d",
    icon: { glyph: "₹" },
    tagline: "GST handled where the order is made.",
    today: ["GST tax invoices with place of supply", "COD fee recorded per order", "Plan pricing in rupees, plus GST"],
    soon: ["Invoice PDF download"],
  },
  {
    id: "shipping", name: "Shipping", ring: 2, status: "partial", tint: "#7fd6c2",
    icon: { d: "M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
    tagline: "Your zones and your rates, not ours.",
    today: ["Shipping zones per store", "Rates you set per zone", "Mark orders shipped and delivered"],
    soon: ["Shiprocket labels and tracking"],
  },
  {
    id: "payments", name: "Payments", ring: 2, status: "soon", tint: "#8f8dff",
    icon: { d: "M2 5h20v14H2zM2 10h20" },
    tagline: "Online payments are on the way.",
    today: ["Today: cash on delivery, with a fee you control"],
    soon: ["Razorpay and UPI checkout"],
  },
  {
    id: "support", name: "Support", ring: 2, status: "partial", tint: "#ff9bb0",
    icon: { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
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
const PAD = 30; // keeps the outer planets and their labels inside the stage

/** Even spacing within a ring, each ring rotated so the planets do not line up. */
function phaseOf(mod: Mod): number {
  const same = MODULES.filter((m) => m.ring === mod.ring);
  const i = same.findIndex((m) => m.id === mod.id);
  return mod.ring * 1.1 + 0.5 + (i * Math.PI * 2) / same.length;
}

interface Open { id: string; x: number; y: number; half: number }

export function Orbit() {
  const stageRef = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLButtonElement | null)[]>([]);
  const pos = useRef<{ x: number; y: number }[]>(MODULES.map(() => ({ x: 0, y: 0 })));
  const size = useRef({ w: 0, h: 0 });
  const frozen = useRef(false);
  const lastType = useRef("mouse");
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
      const rx = (w / 2 - PAD) * (RING_SCALE[m.ring] ?? 1);
      const ry = (h / 2 - PAD) * (RING_SCALE[m.ring] ?? 1);
      const a = phaseOf(m) + (Math.PI * 2 * t) / (RING_SECONDS[m.ring] ?? 100);
      const x = cx + rx * Math.cos(a);
      const y = cy + ry * Math.sin(a);
      const depth = (Math.sin(a) + 1) / 2; // 1 at the front (bottom of the ellipse)
      const half = el.offsetWidth / 2;
      const p = pos.current[i];
      if (p) { p.x = x; p.y = y; }
      el.style.transform = `translate3d(${(x - half).toFixed(1)}px, ${(y - half).toFixed(1)}px, 0) scale(${(0.8 + 0.3 * depth).toFixed(3)})`;
      el.style.zIndex = String(1 + Math.round(depth * 10));
      el.style.opacity = String((0.72 + 0.28 * depth).toFixed(2));
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
  }, [place]);

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
            ry={Math.max(0, (dims.h / 2 - PAD) * k)}
            fill="none"
            stroke="rgb(190 200 255)"
            strokeOpacity={0.16 - i * 0.03}
            strokeDasharray={i === 2 ? "2 7" : undefined}
          />
        ))}
      </svg>

      {/* the store at the centre */}
      <div className="bm-sun" aria-hidden="true">
        <span className="bm-sun-ring" />
        <span className="bm-sun-core">B</span>
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
            {"d" in m.icon ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={m.icon.d} /></svg>
            ) : (
              <span className="text-[1.25rem] font-semibold leading-none" aria-hidden="true">{m.icon.glyph}</span>
            )}
            <i className="bm-planet-dot" style={{ background: STATUS_COLOR[m.status] }} />
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
              {"d" in active.icon ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={active.icon.d} /></svg>
              ) : (
                <span className="text-[1.1rem] font-semibold leading-none" aria-hidden="true">{active.icon.glyph}</span>
              )}
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
