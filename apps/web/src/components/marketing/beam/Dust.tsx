"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../landing/motion.ts";

/**
 * Fine light motes rising from the beam's foot and drifting outward, like dust in a lit shaft. A small canvas
 * (around 70 particles, capped pixel ratio); paused while the tab is hidden; not drawn at all under reduced motion.
 * `foot` is the distance in px from the bottom of the stage to where the beam lands.
 */
export function Dust({ beamX = 0.57, foot = 544 }: { beamX?: number; foot?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || prefersReducedMotion()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    let running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const N = 70;
    const motes = Array.from({ length: N }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 0, max: 1, hue: 0 }));

    const spawn = (m: (typeof motes)[number], first: boolean) => {
      const footY = h - foot;
      m.x = w * beamX + (Math.random() - 0.5) * w * 0.34;
      m.y = footY - Math.random() * (first ? h * 0.8 : 40);
      m.vx = (Math.random() - 0.5) * 0.22;
      m.vy = -(0.08 + Math.random() * 0.32);
      m.r = 0.5 + Math.random() * 1.3;
      m.max = 240 + Math.random() * 380;
      m.life = first ? Math.random() * m.max : 0;
      m.hue = 220 + Math.random() * 50;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const m of motes) spawn(m, true);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = () => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.life += 1;
        m.x += m.vx + (m.x - w * beamX) * 0.00012;
        m.y += m.vy;
        if (m.life > m.max || m.y < 0) spawn(m, false);
        const t = m.life / m.max;
        const a = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 0.7;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${m.hue}, 90%, 82%, ${a.toFixed(3)})`;
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onVis = () => {
      if (document.visibilityState === "hidden") {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [beamX, foot]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />;
}
