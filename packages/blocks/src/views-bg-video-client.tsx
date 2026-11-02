"use client";
/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { useEffect, useRef, type CSSProperties } from "react";

/**
 * Background video that costs nothing until it is worth it. Server HTML carries only the poster; the file is attached
 * after load, and only on screens of 768px and up, without Data Saver and without reduced-motion. Phones therefore
 * never download a multi-megabyte clip they would barely notice (the poster stays as the background).
 */
export function BgVideo({ src, poster, style }: { src: string; poster?: string | undefined; style?: CSSProperties | undefined }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const matches = (query: string) => (globalThis as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia(query).matches;
    const allowed = matches("(min-width: 768px)") && !conn?.saveData && !matches("(prefers-reduced-motion: reduce)");
    if (!allowed) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      // Structural cast: this file is also type-checked by packages without the DOM lib.
      const media = el as unknown as { src: string; play: () => Promise<void> };
      media.src = src;
      void media.play().catch(() => undefined);
    };
    const idle = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const timer = idle ? undefined : setTimeout(start, 1);
    if (idle) idle(start);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [src]);

  return <video ref={ref} loop muted playsInline preload="none" poster={poster} style={style} aria-hidden="true" />;
}
