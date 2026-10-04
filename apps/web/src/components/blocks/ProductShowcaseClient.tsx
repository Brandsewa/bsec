"use client";

import React, { useEffect, useRef, type ReactNode } from "react";
import type { ProductShowcaseBehavior } from "@bs/blocks";

/**
 * Behaviour for the product showcase's server-rendered markup (progressive enhancement, like the hero
 * slider). Without it the carousel is still a swipeable, keyboard-scrollable scroll-snap track showing the
 * first tab. This adds: tab switching, arrows that move one page, page dots (their count depends on how
 * many cards fit, so they are built here and rebuilt on resize), optional autoplay and looping, and the
 * card's add-to-cart button.
 *
 * The cart button adds a single-variant product straight away through the same endpoint as the product page
 * (the server prices it, nothing is trusted from the page); a product with several variants opens its page.
 * Imperative on purpose: it only touches existing DOM, so there is no second hydration of the cards.
 */
export function ProductShowcaseClient({ options, children }: { options: ProductShowcaseBehavior; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = wrap.current?.querySelector<HTMLElement>("[data-psc]");
    if (!root) return;
    const tabs = [...root.querySelectorAll<HTMLElement>("[data-psc-tab]")];
    const panels = [...root.querySelectorAll<HTMLElement>("[data-psc-panel]")];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let active = 0;
    let hovering = false;
    let focusing = false;
    let onScreen = true;
    let interacted = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let raf = 0;
    const cleanups: Array<() => void> = [];

    const parts = (panel: HTMLElement | undefined) => ({
      track: panel?.querySelector<HTMLElement>("[data-psc-track]") ?? null,
      items: panel ? [...panel.querySelectorAll<HTMLElement>("[data-psc-item]")] : [],
      dots: panel?.querySelector<HTMLElement>("[data-psc-dots]") ?? null,
      prev: panel?.querySelector<HTMLButtonElement>("[data-psc-prev]") ?? null,
      next: panel?.querySelector<HTMLButtonElement>("[data-psc-next]") ?? null,
    });

    /** Page geometry of the active panel: how wide one page is and how many there are. */
    const geometry = () => {
      const { track, items } = parts(panels[active]);
      if (!track || items.length === 0) return null;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      const pageWidth = track.clientWidth + gap;
      const itemWidth = (items[0]?.offsetWidth ?? track.clientWidth) + gap;
      const perPage = Math.max(1, Math.round(track.clientWidth / Math.max(1, itemWidth)));
      const pages = Math.max(1, Math.ceil(items.length / perPage));
      return { track, pageWidth, pages, items, perPage };
    };
    const currentPage = () => {
      const g = geometry();
      return g ? Math.min(g.pages - 1, Math.max(0, Math.round(g.track.scrollLeft / g.pageWidth))) : 0;
    };

    const goToPage = (page: number, userAction = false) => {
      const g = geometry();
      if (!g) return;
      if (userAction) interacted = true;
      const target = options.loop ? (page + g.pages) % g.pages : Math.min(g.pages - 1, Math.max(0, page));
      const maxLeft = g.track.scrollWidth - g.track.clientWidth;
      g.track.scrollTo({ left: Math.min(maxLeft, target * g.pageWidth), behavior: reduced ? "auto" : "smooth" });
    };

    const renderDots = () => {
      const { dots } = parts(panels[active]);
      const g = geometry();
      if (!dots || !g) return;
      const page = currentPage();
      if (g.pages <= 1) {
        dots.replaceChildren();
        return;
      }
      if (dots.childElementCount !== g.pages) {
        dots.replaceChildren(
          ...Array.from({ length: g.pages }, (_, i) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "bsb-hs-dotbtn";
            b.setAttribute("aria-label", `Go to page ${i + 1}`);
            b.addEventListener("click", () => goToPage(i, true));
            return b;
          }),
        );
      }
      [...dots.children].forEach((d, i) => (i === page ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
    };

    const renderArrows = () => {
      const { prev, next } = parts(panels[active]);
      const g = geometry();
      const hide = !g || g.pages <= 1;
      for (const [btn, atEdge] of [[prev, currentPage() === 0], [next, g ? currentPage() >= g.pages - 1 : true]] as const) {
        if (!btn) continue;
        btn.hidden = hide;
        btn.disabled = !options.loop && atEdge;
      }
    };

    const render = () => {
      renderDots();
      renderArrows();
    };

    const bindPanel = (i: number) => {
      const { track, prev, next } = parts(panels[i]);
      if (!track) return;
      const onScroll = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          if (i === active) render();
        });
      };
      const onPrev = () => goToPage(currentPage() - 1, true);
      const onNext = () => goToPage(currentPage() + 1, true);
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
      track.addEventListener("scroll", onScroll, { passive: true });
      track.addEventListener("keydown", onKey);
      track.addEventListener("touchstart", onTouch, { passive: true });
      prev?.addEventListener("click", onPrev);
      next?.addEventListener("click", onNext);
      const ro = new ResizeObserver(() => i === active && render());
      ro.observe(track);
      cleanups.push(() => {
        track.removeEventListener("scroll", onScroll);
        track.removeEventListener("keydown", onKey);
        track.removeEventListener("touchstart", onTouch);
        prev?.removeEventListener("click", onPrev);
        next?.removeEventListener("click", onNext);
        ro.disconnect();
      });
    };
    panels.forEach((_, i) => bindPanel(i));

    // Tabs
    const selectTab = (i: number, userAction = true) => {
      if (userAction) interacted = true;
      active = i;
      tabs.forEach((t, ti) => {
        t.setAttribute("aria-selected", String(ti === i));
        t.tabIndex = ti === i ? 0 : -1;
      });
      panels.forEach((p, pi) => (p.hidden = pi !== i));
      const { track } = parts(panels[i]);
      track?.scrollTo({ left: 0, behavior: "auto" });
      render();
    };
    tabs.forEach((t, i) => {
      const click = () => selectTab(i);
      const key = (e: KeyboardEvent) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const n = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[n]?.focus();
        selectTab(n);
      };
      t.addEventListener("click", click);
      t.addEventListener("keydown", key);
      cleanups.push(() => {
        t.removeEventListener("click", click);
        t.removeEventListener("keydown", key);
      });
    });

    // Add to cart (delegated: one listener for every card)
    const onClick = async (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-psc-add]");
      if (!btn) return;
      const variant = btn.dataset["variant"];
      if (!variant) {
        window.location.assign(btn.dataset["href"] ?? "/");
        return;
      }
      if (btn.dataset["state"] === "busy") return;
      btn.dataset["state"] = "busy";
      try {
        const res = await fetch("/api/storefront/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: variant, quantity: 1 }) });
        if (!res.ok) throw new Error("add failed");
        window.dispatchEvent(new Event("cart-updated"));
        btn.dataset["state"] = "done";
        setTimeout(() => delete btn.dataset["state"], 1500);
      } catch {
        // The cart is unchanged: send the shopper to the product page, where the real error is shown.
        window.location.assign(btn.dataset["href"] ?? "/");
      }
    };
    root.addEventListener("click", onClick);

    const enter = () => (hovering = true);
    const leave = () => (hovering = false);
    const focusIn = () => (focusing = true);
    const focusOut = () => (focusing = false);
    root.addEventListener("mouseenter", enter);
    root.addEventListener("mouseleave", leave);
    root.addEventListener("focusin", focusIn);
    root.addEventListener("focusout", focusOut);

    const io = new IntersectionObserver(([entry]) => (onScreen = Boolean(entry?.isIntersecting)), { threshold: 0.2 });
    io.observe(root);

    if (options.autoplay && !reduced) {
      timer = setInterval(() => {
        const g = geometry();
        if (!g || g.pages <= 1 || interacted || document.hidden || !onScreen || focusing || (options.pauseOnHover && hovering)) return;
        if (!options.loop && currentPage() >= g.pages - 1) return;
        goToPage(currentPage() + 1);
      }, Math.max(2, options.interval) * 1000);
    }

    render();

    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      io.disconnect();
      cleanups.forEach((c) => c());
      root.removeEventListener("click", onClick);
      root.removeEventListener("mouseenter", enter);
      root.removeEventListener("mouseleave", leave);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
    };
  }, [options.tabs, options.autoplay, options.interval, options.loop, options.pauseOnHover]);

  return (
    <div ref={wrap} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
