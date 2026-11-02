"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "@bs/ui";
import { isThemedPath } from "@/lib/themed-paths.ts";

/** Theme provider for apps/web: active on the sign-up page (see themed-paths.ts), and with `always` on the whole platform site. */
export function WebThemeProvider({ children, always = false }: { children: ReactNode; always?: boolean }) {
  const pathname = usePathname();
  return <ThemeProvider enabled={always || isThemedPath(pathname)}>{children}</ThemeProvider>;
}
