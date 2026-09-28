import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bs Commerce",
  description: "Launch your online store in 10 minutes.",
  // M0: nothing is public yet. The per-store indexing switch arrives in M3 (PLAN §8.3).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
