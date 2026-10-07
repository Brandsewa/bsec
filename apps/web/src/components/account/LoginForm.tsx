"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, FieldLabel, Input, Alert, AlertDescription, Tabs, TabsList, TabsTrigger } from "@bs/ui";

export function LoginForm({ initialTab = "otp" }: { initialTab?: "password" | "otp" }) {
  const router = useRouter();
  const [tab, setTab] = useState<"password" | "otp">(initialTab);

  // Password login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
      await post("/api/storefront/customer/login", { email: email.trim(), password });
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
      await post("/api/storefront/customer/otp/request", { phone: phone.trim() });
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
      await post("/api/storefront/customer/otp/verify", { phone: phone.trim(), otp: otp.trim() });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify the code");
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-5" data-testid="login-form">
      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(val) => {
          setTab(val as "password" | "otp");
          setError(null);
        }}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="otp" className="text-xs">
            Phone Code
          </TabsTrigger>
          <TabsTrigger value="password" className="text-xs">
            Email & Password
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      ) : null}

      {tab === "password" ? (
        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <Field className="space-y-1.5">
            <FieldLabel htmlFor="login-email">Email address</FieldLabel>
            <Input
              id="login-email"
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="you@example.com"
              className="h-10 sm:h-9"
            />
          </Field>

          <Field className="space-y-1.5">
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="login-password">Password</FieldLabel>
              <Link href="/account/forgot-password" className="text-xs text-[var(--brand-ink)] hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="login-password"
                required
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-10 sm:h-9 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] p-1 text-xs"
              >
                {showPassword ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </Field>

          <Button type="submit" size="md" disabled={busy} loading={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>

          <p className="pt-1 text-center text-xs text-[var(--muted-foreground)]">
            Don&apos;t have an account?{" "}
            <Link href="/account/register" className="font-semibold text-[var(--brand-ink)] hover:underline">
              Create account
            </Link>
          </p>
        </form>
      ) : step === "phone" ? (
        <form onSubmit={sendCode} className="space-y-4">
          <Field className="space-y-1.5">
            <FieldLabel htmlFor="login-phone">Mobile number</FieldLabel>
            <Input
              id="login-phone"
              required
              inputMode="numeric"
              pattern="[6-9][0-9]{9}"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              autoComplete="tel-national"
              placeholder="10-digit number"
              className="h-10 sm:h-9"
            />
          </Field>

          <Button type="submit" size="md" disabled={busy || phone.length < 10} loading={busy} className="w-full">
            {busy ? "Sending…" : "Send code"}
          </Button>

          <p className="pt-1 text-center text-xs text-[var(--muted-foreground)]">
            Don&apos;t have an account?{" "}
            <Link href="/account/register" className="font-semibold text-[var(--brand-ink)] hover:underline">
              Create account
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            Enter the 6-digit code sent to <strong className="text-[var(--foreground)]">{phone}</strong>.
          </p>
          <Field className="space-y-1.5">
            <FieldLabel htmlFor="login-otp">Verification code</FieldLabel>
            <Input
              id="login-otp"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              autoComplete="one-time-code"
              placeholder="6-digit code"
              className="h-10 sm:h-9 tracking-widest font-mono text-center text-base"
            />
          </Field>

          <Button type="submit" size="md" disabled={busy || otp.length < 6} loading={busy} className="w-full">
            {busy ? "Checking…" : "Sign in"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStep("phone");
              setOtp("");
              setError(null);
            }}
            className="w-full text-xs"
          >
            Use a different number
          </Button>
        </form>
      )}
    </div>
  );
}
