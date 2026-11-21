"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BRIDGE_FRAME_PATH, parseBridgeMessage } from "@/lib/turnstile-bridge.ts";

const subscribeNever = () => () => {};

/**
 * Turnstile challenge for a store on its own domain: the widget runs in a frame served from the platform host (the one
 * hostname Cloudflare knows) and posts the token back. Messages count only when they come from this frame element and
 * from `origin`. The frame stays zero-height unless Cloudflare needs the shopper to do something (audit A3-04).
 */
export function TurnstileBridge({ origin, onToken, onFailure }: { origin: string; onToken: (token: string | null) => void; onFailure?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  // The page's own origin is only known in the browser (null while rendering on the server); the frame posts the token to exactly it.
  const pageOrigin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => null);
  const src = pageOrigin ? `${origin}${BRIDGE_FRAME_PATH}?parent=${encodeURIComponent(pageOrigin)}` : null;
  const [height, setHeight] = useState(0);
  const onTokenRef = useRef(onToken);
  const onFailureRef = useRef(onFailure);

  useEffect(() => {
    onTokenRef.current = onToken;
    onFailureRef.current = onFailure;
  }, [onToken, onFailure]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = parseBridgeMessage(event.data, event.origin, origin, event.source !== null && event.source === frame.current?.contentWindow);
      if (!msg) return;
      if (msg.kind === "token") onTokenRef.current(msg.token);
      else if (msg.kind === "expired") onTokenRef.current(null);
      else if (msg.kind === "failed") {
        onTokenRef.current(null);
        onFailureRef.current?.();
      } else setHeight(msg.height);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);

  return (
    <div data-turnstile-bridge>
      {src ? <iframe ref={frame} src={src} title="Security check" scrolling="no" style={{ border: 0, width: "100%", maxWidth: 320, height, display: "block" }} /> : null}
    </div>
  );
}
