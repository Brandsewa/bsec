"use client";

import React, { useEffect, useRef, type ReactNode } from "react";
import type { HeroSliderBehavior } from "@bs/blocks";

/**
 * Adds behaviour to the hero slider's server-rendered markup (progressive enhancement). The slider is
 * already a working swipeable, keyboard-scrollable scroll-snap track without any of this; this adds:
 * arrow and dot navigation, autoplay, looping, and playing only the visible slide's video.
 *
 * It is imperative on purpose: it touches the existing DOM (aria-current, disabled, video play/pause) and
 * never re-renders React, so the markup is not hydrated twice and a slider costs a single small effect.
 * Autoplay stops for visitors who prefer reduced motion, while the slider is off screen or in a hidden tab,
 * while it is hovered or focused, and after the visitor swipes or uses a control. Videos are skipped on
 * Save-Data connections (the poster image stays).
 */
export function HeroSliderClient({ options, children }: { options: HeroSliderBehavior; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = wrap.current?.querySelector<HTMLElement>("[data-hs]");
    const track = root?.querySelector<HTMLElement>("[data-hs-track]");
    if (!root || !track) return;
    const slides = [...track.querySelectorAll<HTMLElement>("[data-hs-slide]")];
    const n = slides.length;
    if (n < 2) {
      // One slide: no controls to drive, but its video still plays.
      slides[0]?.querySelector("video")?.play().catch(() => undefined);
      return;
    }
    const dots = [...root.querySelectorAll<HTMLElement>("[data-hs-dot]")];
    const prev = root.querySelector<HTMLButtonElement>("[data-hs-prev]");
    const next = root.querySelector<HTMLButtonElement>("[data-hs-next]");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);

    let index = 0;
    let hovering = false;
    let focusing = false;
    let onScreen = true;
    let interacted = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let raf = 0;

    const clamp = (i: number) => (options.loop ? (i + n) % n : Math.min(n - 1, Math.max(0, i)));
    const goTo = (i: number, userAction = false) => {
      if (userAction) interacted = true;
      const target = slides[clamp(i)];
      if (target) track.scrollTo({ left: target.offsetLeft, behavior: reduced ? "auto" : "smooth" });
    };

    const syncVideos = () => {
      slides.forEach((slide, i) => {
        const video = slide.querySelector<HTMLVideoElement>("video");
        if (!video) return;
        if (saveData || reduced) {
          video.pause();
          return;
        }
        if (i === index) {
          video.preload = "auto";
          video.play().catch(() => undefined);
        } else {
          video.pause();
          // Warm the next slide's video only; the rest stay unloaded.
          if (i === (index + 1) % n && video.preload === "none") video.preload = "metadata";
        }
      });
    };

    const render = () => {
      dots.forEach((d, i) => (i === index ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
      slides.forEach((s, i) => s.setAttribute("aria-hidden", i === index ? "false" : "true"));
      if (!options.loop) {
        if (prev) prev.disabled = index === 0;
        if (next) next.disabled = index === n - 1;
      }
      syncVideos();
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        if (i !== index && i >= 0 && i < n) {
          index = i;
          render();
        }
      });
    };

    const paused = () => !options.autoplay || reduced || interacted || document.hidden || !onScreen || focusing || (options.pauseOnHover && hovering);
    const startTimer = () => {
      if (!options.autoplay || reduced) return;
      timer = setInterval(() => {
        if (paused()) return;
        if (!options.loop && index === n - 1) return;
        goTo(index + 1);
      }, Math.max(2, options.interval) * 1000);
    };

    const onPrev = () => goTo(index - 1, true);
    const onNext = () => goTo(index + 1, true);
    const dotHandlers = dots.map((_, i) => () => goTo(i, true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onNext();
      }
    };
    const onTouch = () => {
      interacted = true;
    };
    const enter = () => (hovering = true);
    const leave = () => (hovering = false);
    const focusIn = () => (focusing = true);
    const focusOut = () => (focusing = false);

    prev?.addEventListener("click", onPrev);
    next?.addEventListener("click", onNext);
    dots.forEach((d, i) => dotHandlers[i] && d.addEventListener("click", dotHandlers[i]));
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("keydown", onKey);
    track.addEventListener("touchstart", onTouch, { passive: true });
    root.addEventListener("mouseenter", enter);
    root.addEventListener("mouseleave", leave);
    root.addEventListener("focusin", focusIn);
    root.addEventListener("focusout", focusOut);

    // Pause everything while the slider is scrolled out of view (saves CPU and battery, and videos).
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = Boolean(entry?.isIntersecting);
        if (!onScreen) slides.forEach((s) => s.querySelector("video")?.pause());
        else syncVideos();
      },
      { threshold: 0.25 },
    );
    io.observe(root);

    render();
    startTimer();

    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      io.disconnect();
      prev?.removeEventListener("click", onPrev);
      next?.removeEventListener("click", onNext);
      dots.forEach((d, i) => dotHandlers[i] && d.removeEventListener("click", dotHandlers[i]));
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("keydown", onKey);
      track.removeEventListener("touchstart", onTouch);
      root.removeEventListener("mouseenter", enter);
      root.removeEventListener("mouseleave", leave);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
    };
  }, [options.autoplay, options.interval, options.loop, options.pauseOnHover]);

  return (
    <div ref={wrap} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
