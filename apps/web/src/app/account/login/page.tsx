import React from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/account/LoginForm.tsx";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <LoginForm initialTab="password" />
    </div>
  );
}
