import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Database, ShieldCheck } from "lucide-react";
import { Button, Input, Label, toast } from "@bs/ui";
import {
  fetchLoginStatus,
  finishMfaSetup,
  signIn,
  signOut,
  startMfaSetup,
  verifyBackupCode,
  verifyTotp,
  type MfaSetup,
} from "../lib/auth.ts";
import { messageOf } from "../lib/errors.ts";

interface LoginProps {
  onSuccess: () => void;
}

type Step = "credentials" | "twoFactor" | "setupIntro" | "setupCode";

export function Login({ onSuccess }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("credentials");
  const [totpCode, setTotpCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  // First-time authenticator setup
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [setupCode, setSetupCode] = useState("");

  const backToSignIn = (message?: string) => {
    setStep("credentials");
    setPassword("");
    setTotpCode("");
    setBackupCode("");
    setSetup(null);
    setSavedCodes(false);
    setSetupCode("");
    setError(null);
    setNotice(message ?? null);
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await signIn(email, password);
      if (res.ok) {
        // A session exists. Decide what it may do: with MFA required, only a fully enrolled, fresh
        // session enters the app; with the platform toggle off, password-only is enough.
        const status = await fetchLoginStatus();
        if (!status.isPlatformStaff) {
          await signOut();
          setError("This account is not a platform staff account.");
        } else if (status.mfaRequired !== false && !status.mfaEnrolled) {
          setStep("setupIntro");
        } else if (status.sessionValid) {
          toast.success("Welcome to Super Admin");
          onSuccess();
        } else {
          await signOut();
          setError("Please sign in again.");
        }
      } else if (res.twoFactorRequired) {
        setStep("twoFactor");
      } else {
        setError(res.message);
      }
    } catch (err) {
      setError(messageOf(err, "An unexpected error occurred"));
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = useBackupCode ? await verifyBackupCode(backupCode) : await verifyTotp(totpCode);
      if (res.ok) {
        const status = await fetchLoginStatus();
        if (status.sessionValid) {
          toast.success("MFA verified. Signed into Super Admin.");
          onSuccess();
        } else {
          setError("Signed in, but this account has no access. Contact a platform owner.");
        }
      } else {
        setError(res.message || "Invalid verification code.");
      }
    } catch (err) {
      setError(messageOf(err, "Failed to verify two-factor authentication."));
    } finally {
      setLoading(false);
    }
  };

  const handleStartSetup = async () => {
    setError(null);
    setLoading(true);
    const res = await startMfaSetup(password);
    setLoading(false);
    if (res.ok) {
      setSetup(res.setup);
      setStep("setupCode");
    } else {
      setError(res.message);
    }
  };

  const handleFinishSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await finishMfaSetup(setupCode);
    setLoading(false);
    if (res.ok) {
      backToSignIn("Authenticator set up. Sign in again with your password and a code from your app.");
    } else {
      setError(res.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Bs Commerce Super Admin</h1>
          <p className="text-sm text-muted-foreground">Platform Operations & Management Portal</p>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive font-medium border border-destructive/20">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mb-4 rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 border border-emerald-500/20">
            {notice}
          </div>
        )}

        {step === "credentials" && (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Platform Staff Email</Label>
              <Input id="email" type="email" placeholder="staff@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Input id="password" type="password" placeholder="••••••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Authenticating..." : "Sign In with Credentials"}
            </Button>
            <p className="text-center text-xs text-muted-foreground mt-4">Access restricted to authorized platform staff with verified MFA.</p>
          </form>
        )}

        {step === "twoFactor" && (
          <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
            <div className="rounded-lg bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-400 border border-blue-500/20 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Two-factor authentication is required. Enter the 6-digit code from your authenticator app, or a backup code.</span>
            </div>
            {!useBackupCode ? (
              <div>
                <Label htmlFor="totp">Authenticator Code (6 digits)</Label>
                <Input id="totp" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value.trim())} required autoFocus />
              </div>
            ) : (
              <div>
                <Label htmlFor="backup">Backup Code</Label>
                <Input id="backup" type="text" placeholder="e.g. abcd-1234" value={backupCode} onChange={(e) => setBackupCode(e.target.value.trim())} required autoFocus />
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Verifying..." : "Verify & Complete Login"}
            </Button>
            <div className="flex justify-between items-center text-xs pt-2">
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setUseBackupCode(!useBackupCode)}>
                {useBackupCode ? "Use authenticator code instead" : "Use a backup code"}
              </button>
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => backToSignIn()}>
                Back to sign in
              </button>
            </div>
          </form>
        )}

        {step === "setupIntro" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 border border-amber-500/30 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Platform accounts need two-factor authentication. Set up an authenticator app (Google Authenticator, 1Password, Authy…) now.
                You will be signed out afterwards and sign in again with a code.
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm your password to generate your secret</Label>
              <Input id="confirm-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button className="w-full" disabled={loading || !password} onClick={handleStartSetup}>
              {loading ? "Working..." : "Generate my authenticator secret"}
            </Button>
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => void signOut().then(() => backToSignIn())}>
              Cancel and sign out
            </button>
          </div>
        )}

        {step === "setupCode" && setup && (
          <form onSubmit={handleFinishSetup} className="space-y-4">
            <div className="space-y-2 text-xs">
              <p className="font-semibold">1. Add this account to your authenticator app</p>
              <p className="text-muted-foreground">Choose “enter a setup key” and paste the key below (account: your email, type: time-based).</p>
              <div className="rounded-md border bg-muted p-2 font-mono text-sm break-all select-all" data-testid="totp-secret">{setup.secret}</div>
              <a className="text-primary underline" href={setup.otpauthUri}>Open in authenticator app</a>
            </div>
            <div className="space-y-2 text-xs">
              <p className="font-semibold">2. Save your backup codes (each works once, if you lose your phone)</p>
              <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted p-2 font-mono text-xs select-all" data-testid="backup-codes">
                {setup.backupCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />
                <span>I have saved these backup codes somewhere safe</span>
              </label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="setup-code">3. Enter the 6-digit code your app shows</Label>
              <Input id="setup-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={setupCode} onChange={(e) => setSetupCode(e.target.value.trim())} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !savedCodes || setupCode.length !== 6}>
              {loading ? "Verifying..." : "Verify and finish setup"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
