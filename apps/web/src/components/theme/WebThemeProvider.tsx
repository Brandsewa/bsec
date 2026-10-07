"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "@bs/ui";
import { isThemedPath } from "@/lib/themed-paths.ts";

/** Theme provider for apps/web: active only on account, auth and token pages (see themed-paths.ts). */
export function WebThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <ThemeProvider enabled={isThemedPath(pathname)}>{children}</ThemeProvider>;
}
