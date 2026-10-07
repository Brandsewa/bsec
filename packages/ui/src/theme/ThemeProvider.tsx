"use client";

import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { THEME_STORAGE_KEY } from "./bootScript.ts";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === "light" || val === "dark" || val === "system") {
      return val;
    }
  } catch (err) {
    void err;
  }
  return "system";
}

export function ThemeProvider({
  children,
  defaultPreference = "system",
  enabled = true,
}: {
  children: React.ReactNode;
  defaultPreference?: ThemePreference;
  /** When false the provider leaves <html> alone (used on the merchant storefront, which has its own look). */
  enabled?: boolean;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return defaultPreference;
    return getStoredPreference();
  });

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());

  const resolved: ResolvedTheme = preference === "system" ? systemTheme : preference;

  // Listen to system preference changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Sync with storage across tabs
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        const val = e.newValue;
        if (val === "light" || val === "dark" || val === "system") {
          setPreferenceState(val);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Update DOM when resolved theme changes with smooth animation
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    if (!enabled) {
      delete root.dataset.theme;
      root.style.removeProperty("color-scheme");
      return;
    }
    const current = root.dataset.theme;

    // If initial mount or theme unchanged, apply directly without animation
    if (!current || current === resolved) {
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
      return;
    }

    const applyTheme = () => {
      root.dataset.theme = resolved;
      root.style.colorScheme = resolved;
    };

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // View Transitions API: native hardware-accelerated smooth cross-fade
    const docWithTransitions = document as Document & {
      startViewTransition?: (updateCallback: () => void | Promise<void>) => unknown;
    };

    if (typeof docWithTransitions.startViewTransition === "function" && !prefersReducedMotion) {
      docWithTransitions.startViewTransition(() => {
        applyTheme();
      });
    } else if (!prefersReducedMotion) {
      // CSS-based smooth transition fallback
      root.classList.add("theme-transitioning");
      applyTheme();
      const timer = window.setTimeout(() => {
        root.classList.remove("theme-transitioning");
      }, 300);
      return () => window.clearTimeout(timer);
    } else {
      applyTheme();
    }
  }, [resolved, enabled]);

  const setPreference = (pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch (err) {
      void err;
    }
  };

  const value = useMemo(
    () => ({
      preference,
      resolved,
      setPreference,
    }),
    [preference, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      preference: "system",
      resolved: "light",
      setPreference: () => {},
    };
  }
  return ctx;
}
