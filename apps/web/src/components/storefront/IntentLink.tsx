"use client";

import React, { forwardRef, useState, type ComponentProps } from "react";
import Link from "next/link";

/**
 * A next/link that prefetches its page only when the shopper shows intent (pointer over it, a touch, or keyboard focus),
 * not as soon as it scrolls into view. Storefront pages are dynamic, so every in-view link used to fire its own request at the
 * server: a single page view produced 30 to 40 extra requests (Cloudflare logs, 2026-11-04), each running the full request
 * pipeline. The first interaction arms the link and Next then prefetches it as usual, so clicks still feel instant.
 */
export const IntentLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof Link>>(function IntentLink(
  { prefetch, onMouseEnter, onTouchStart, onFocus, ...rest },
  ref,
) {
  const [armed, setArmed] = useState(false);
  // An explicit prefetch choice from the caller wins; otherwise wait for intent.
  const effective = prefetch !== undefined ? prefetch : armed ? null : false;
  return (
    <Link
      ref={ref}
      {...rest}
      prefetch={effective}
      onMouseEnter={(e) => {
        setArmed(true);
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        setArmed(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setArmed(true);
        onFocus?.(e);
      }}
    />
  );
});

export default IntentLink;
