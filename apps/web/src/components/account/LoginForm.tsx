"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

/** Phone number, then the 6-digit code we send. The server sets the session cookie; the page then reloads signed in. */
export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post("/api/storefront/customer/otp/request", { phone });
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post("/api/storefront/customer/otp/verify", { phone, otp });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify the code");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8" data-testid="login-form">
      <h1 className="text-2xl font-extrabold text-foreground">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Use your mobile number to see your orders and saved addresses.</p>
      {step === "phone" ? (
        <form onSubmit={sendCode} className="mt-5 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Mobile number</span>
            <input
              required
              inputMode="numeric"
              pattern="[6-9][0-9]{9}"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
              autoComplete="tel-national"
              placeholder="10-digit number"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-5 space-y-4">
          <p className="text-sm text-muted-foreground">Enter the 6-digit code sent to {phone}.</p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Code</span>
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
              autoComplete="one-time-code"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setOtp("");
              setError(null);
            }}
            className="w-full text-sm text-muted-foreground hover:underline"
          >
            Use a different number
          </button>
        </form>
      )}
    </div>
  );
}
