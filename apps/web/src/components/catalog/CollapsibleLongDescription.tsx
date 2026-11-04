"use client";

import React, { useId, useState } from "react";

/**
 * Collection long description. From md up it is always shown (the caller centres it); on phones it sits behind a
 * "Learn more about {title}" button. The content stays in the DOM either way so search engines still read it.
 */
export function CollapsibleLongDescription({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 w-full items-center justify-between rounded-lg border border-border px-4 text-left text-sm font-semibold md:hidden"
      >
        <span>{open ? `Show less about ${title}` : `Learn more about ${title}`}</span>
        <svg aria-hidden className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id={id} className={`${open ? "mt-6" : "hidden"} md:mt-0 md:block`}>
        {children}
      </div>
    </>
  );
}
