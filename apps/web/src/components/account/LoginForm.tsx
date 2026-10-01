"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const inputClass = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export function LoginForm({ initialTab = "otp" }: { initialTab?: "password" | "otp" }) {
  const router = useRouter();
  const [tab, setTab] = useState<"password" | "otp">(initialTab);

  // Password login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // OTP login state
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
    return data;
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post("/api/storefront/customer/login", { email, password });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid email or password");
      setBusy(false);
    }
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
      <p className="mt-1 text-sm text-muted-foreground">Access your orders, addresses, and account details.</p>

      {/* Tabs */}
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1 text-center text-xs font-semibold">
        <button
          type="button"
          onClick={() => {
            setTab("password");
            setError(null);
          }}
          className={`rounded-md py-1.5 transition-colors ${
            tab === "password" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Email & Password
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("otp");
            setError(null);
          }}
          className={`rounded-md py-1.5 transition-colors ${
            tab === "otp" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Phone Code
        </button>
      </div>

      {tab === "password" ? (
        <form onSubmit={handlePasswordLogin} className="mt-5 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-foreground">Email address</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              autoComplete="username"
              placeholder="you@example.com"
            />
          </label>

          <label className="block text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-foreground">Password</span>
              <Link href="/account/forgot-password" className="text-xs text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              autoComplete="current-password"
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/account/register" className="font-semibold text-primary hover:underline">
              Create account
            </Link>
          </p>
        </form>
      ) : step === "phone" ? (
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
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send code"}
          </button>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/account/register" className="font-semibold text-primary hover:underline">
              Create account
            </Link>
          </p>
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
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
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

