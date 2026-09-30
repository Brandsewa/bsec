import React, { useState } from "react";
import { Database, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { Button, Input, Label, toast } from "@bs/ui";
import { signIn, verifyTotp, verifyBackupCode } from "../lib/auth.ts";

interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2FA state
  const [step, setStep] = useState<"credentials" | "twoFactor">("credentials");
  const [totpCode, setTotpCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState("");

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await signIn(email, password);
      if (res.ok) {
        toast.success("Welcome to Super Admin");
        onSuccess();
      } else if (res.twoFactorRequired) {
        setStep("twoFactor");
      } else {
        setError(res.message);
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = useBackupCode
        ? await verifyBackupCode(backupCode)
        : await verifyTotp(totpCode);

      if (res.ok) {
        toast.success("MFA verified. Signed into Super Admin.");
        onSuccess();
      } else {
        setError(res.message || "Invalid verification code.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to verify two-factor authentication.");
    } finally {
      setLoading(false);
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
          <p className="text-sm text-muted-foreground">
            Platform Operations & Management Portal
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive font-medium border border-destructive/20">
            {error}
          </div>
        )}

        {step === "credentials" ? (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Platform Staff Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="staff@platform.gobs.cloud"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Authenticating..." : "Sign In with Credentials"}
            </Button>
            <p className="text-center text-xs text-muted-foreground mt-4">
              Access restricted to authorized platform staff with verified MFA.
            </p>
          </form>
        ) : (
          <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
            <div className="rounded-lg bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-400 border border-blue-500/20 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Two-Factor Authentication is required for Super Admin. Enter your 6-digit authenticator app code or a backup code.
              </span>
            </div>

            {!useBackupCode ? (
              <div>
                <Label htmlFor="totp">Authenticator Code (6 digits)</Label>
                <Input
                  id="totp"
                  type="text"
                  placeholder="123456"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.trim())}
                  required
                  autoFocus
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="backup">Emergency Backup Code</Label>
                <Input
                  id="backup"
                  type="text"
                  placeholder="e.g. abcd-1234"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.trim())}
                  required
                  autoFocus
                />
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Verifying..." : "Verify & Complete Login"}
            </Button>

            <div className="flex justify-between items-center text-xs pt-2">
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => setUseBackupCode(!useBackupCode)}
              >
                {useBackupCode ? "Use Authenticator Code instead" : "Use Backup Code"}
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:underline"
                onClick={() => {
                  setStep("credentials");
                  setError(null);
                }}
              >
                Back to Sign In
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
