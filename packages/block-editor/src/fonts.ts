import { useEffect } from "react";

/** Adds a stylesheet link while mounted (theme fonts in the editor canvas and previews). */
export function useFontLink(href: string | null | undefined): void {
  useEffect(() => {
    if (!href) return;
    const existing = document.head.querySelector<HTMLLinkElement>(`link[data-bs-fonts][href="${href}"]`);
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset["bsFonts"] = "1";
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [href]);
}
