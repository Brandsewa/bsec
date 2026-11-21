"use client";

import React from "react";

/**
 * A date and time in the visitor's own locale and timezone. The server cannot know either, so its text can differ from the
 * browser's; that is expected here and React is told so rather than logging a hydration mismatch.
 */
export function LocalTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}
