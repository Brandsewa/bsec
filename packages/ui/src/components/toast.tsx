import { Toaster as Sonner, toast } from "sonner";

/** Button action → spinner → toast (PLAN §12). */
export function Toaster({ theme = "light" }: { theme?: "light" | "dark" | "system" }) {
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!bg-overlay !border-border-strong !text-foreground",
          description: "!text-foreground-light",
        },
      }}
    />
  );
}

export { toast };
