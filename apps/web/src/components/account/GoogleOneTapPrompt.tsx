"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { GoogleSignIn } from "./GoogleSignIn.tsx";

/**
 * Google One Tap on the store home page and content pages (About us and similar), so a visitor can sign in at once and
 * keep browsing; saved addresses then fill in at checkout. Renders nothing itself. It is silent when Google sign-in is
 * off for this store or host, or when the visitor is already signed in (the config route answers "disabled").
 */
export function GoogleOneTapPrompt() {
  const pathname = usePathname();
  return <GoogleSignIn redirectTo={pathname || "/"} button={false} />;
}
