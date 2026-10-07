import { useEffect, useState } from "react";
import { Toaster as Sonner, toast } from "sonner";

/** Button action → spinner → toast (PLAN §12). */
export function Toaster({ theme }: { theme?: "light" | "dark" | "system" }) {
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">(() => {
    if (typeof document !== "undefined") {
      const dt = document.documentElement.dataset.theme;
      if (dt === "dark" || dt === "light") return dt;
    }
    return "light";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      const dt = document.documentElement.dataset.theme;
      if (dt === "dark" || dt === "light") {
        setCurrentTheme(dt);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const activeTheme = theme ?? currentTheme;

  return (
    <Sonner
      theme={activeTheme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!bg-card !border !border-border !text-foreground shadow-lg",
          title: "!text-foreground !font-medium",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
          cancelButton: "!bg-muted !text-muted-foreground",
        },
      }}
    />
  );
}

export { toast };

