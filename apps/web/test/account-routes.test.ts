import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buttonVariants } from "@bs/ui/server";

const account = path.join(__dirname, "../src/app/account");
const read = (rel: string) => fs.readFileSync(path.join(account, rel), "utf8");

describe("customer account routes", () => {
  it("keeps the sign-in gate on the signed-in pages only, so the public pages can be reached signed out", () => {
    // The gate shows the sign-in screen to a visitor; if it wrapped every /account page, "Create account" and the password
    // reset and email verification links would all land on the sign-in screen.
    expect(read("layout.tsx")).not.toContain("AccountGate");
    expect(read("(dashboard)/layout.tsx")).toContain("AccountGate");
    for (const dir of ["login", "register", "forgot-password", "reset-password", "verify-email"]) {
      expect(fs.existsSync(path.join(account, dir)), `${dir} sits beside the gated group`).toBe(true);
      expect(fs.existsSync(path.join(account, "(dashboard)", dir)), `${dir} is not behind the gate`).toBe(false);
    }
    for (const page of ["page.tsx", "orders/page.tsx", "orders/[id]/page.tsx", "addresses/page.tsx", "profile/page.tsx", "reviews/page.tsx", "notifications/page.tsx"]) {
      expect(fs.existsSync(path.join(account, "(dashboard)", page)), `${page} is behind the gate`).toBe(true);
    }
  });

  it("gives every account page a loading file next to it", () => {
    for (const dir of ["(dashboard)", "(dashboard)/addresses", "(dashboard)/profile", "(dashboard)/orders", "(dashboard)/reviews", "(dashboard)/notifications", "(dashboard)/orders/[id]", "login", "register", "forgot-password", "reset-password/[token]", "verify-email/[token]"]) {
      expect(fs.existsSync(path.join(account, dir, "loading.tsx")), `${dir}/loading.tsx`).toBe(true);
    }
  });

  it("offers the button look to server components as a plain class string (the order page calls it on the server)", () => {
    const cls = buttonVariants({ variant: "secondary", size: "sm" });
    expect(typeof cls).toBe("string");
    expect(cls).toContain("inline-flex");
  });
});
