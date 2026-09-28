import React from "react";

export interface StoreStatusBannerProps {
  isBypass?: boolean | undefined;
  mode?: string | undefined;
}

export function StoreStatusBanner({ isBypass, mode }: StoreStatusBannerProps) {
  if (!isBypass) return null;

  const modeLabel = mode ?? "preview";
  const message = `Staff Preview Mode: Store is currently in "${modeLabel}" mode.`;

  return (
    <div
      role="banner"
      className="sticky top-0 z-50 flex items-center justify-between border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900 shadow-sm"
    >
      <div className="mx-auto flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        <span>{message}</span>
      </div>
    </div>
  );
}
