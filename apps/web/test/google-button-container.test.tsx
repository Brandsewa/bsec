import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams("t=ticket"),
}));

// Regression: Google draws its button into a container element. The container must already exist in the very first
// render, before Google's script loads; a container rendered only after the page is "ready" never received the button.
describe("Google button container", () => {
  it("the customer sign-in component mounts its container (hidden until Google is on)", async () => {
    const { GoogleSignIn } = await import("../src/components/account/GoogleSignIn.tsx");
    const html = renderToString(React.createElement(GoogleSignIn, { redirectTo: "/account" }));
    expect(html).toContain('data-testid="google-signin"');
    expect(html).toContain("hidden");
    expect(html).toContain("flex justify-center");
  });

  it("the prompt-only use (home and content pages) draws no markup at all", async () => {
    const { GoogleSignIn } = await import("../src/components/account/GoogleSignIn.tsx");
    const html = renderToString(React.createElement(GoogleSignIn, { redirectTo: "/", button: false }));
    expect(html).toBe("");
  });

  it("the setup test page mounts its container while still loading", async () => {
    const { GoogleVerifyClient } = await import("../src/components/account/GoogleVerifyClient.tsx");
    const html = renderToString(React.createElement(GoogleVerifyClient));
    expect(html).toContain("Getting ready");
    expect(html).not.toContain("Verified");
    expect(html).toContain("flex justify-center");
  });
});
