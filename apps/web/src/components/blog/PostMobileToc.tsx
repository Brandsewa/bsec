"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Table of contents on phones: open at its normal place in the post. Once the reader has scrolled past it, a bar sticks to the bottom of the
 * screen, above the quick-navigation bar; tapping it opens the list so they can jump to a section (the list closes after a jump).
 */
export function PostMobileToc({ items }: { items: Array<{ id: string; text: string }> }) {
  const inline = useRef<HTMLDetailsElement>(null);
  const [past, setPast] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = inline.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      // Past = out of view and above the viewport, not merely below it on first paint.
      const next = !!entry && !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
      setPast(next);
      if (!next) setOpen(false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const list = (
    <ol>
      {items.map((h) => (
        <li key={h.id}>
          <a href={`#${h.id}`} onClick={() => setOpen(false)}>{h.text}</a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <details className="bsb-bp-toc-m" ref={inline} open>
        <summary>Table of contents</summary>
        <nav aria-label="Table of contents">{list}</nav>
      </details>
      {past ? (
        <div className="bsb-bp-toc-bar">
          {open ? <nav aria-label="Table of contents" className="bsb-bp-toc-bar-list">{list}</nav> : null}
          <button type="button" className="bsb-bp-toc-bar-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span>Table of contents</span>
            <span aria-hidden="true">{open ? "⌄" : "⌃"}</span>
          </button>
        </div>
      ) : null}
    </>
  );
}
