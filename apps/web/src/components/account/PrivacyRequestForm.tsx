"use client";

import React, { useState } from "react";
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Textarea,
  SimpleSelect,
  Alert,
  AlertDescription,
} from "@bs/ui";

const PRIVACY_REQUEST_TYPES = [
  { value: "access", label: "Access data (Export personal information)" },
  { value: "correction", label: "Correction of personal data" },
  { value: "erasure", label: "Erasure / Deletion of personal data" },
  { value: "withdraw_consent", label: "Withdraw marketing consent" },
  { value: "grievance", label: "Privacy grievance / inquiry" },
];

export function PrivacyRequestForm() {
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState("access");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch("/api/storefront/privacy-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), kind, details: details || undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit request");
      }

      setStatus("success");
      setMessage(data.message || "Request submitted. Please check your email to verify.");
    } catch (err: unknown) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "An error occurred while submitting your request.";
      setMessage(msg);
    }
  };

  if (status === "success") {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xs space-y-4">
        <div className="flex items-center space-x-3 text-[var(--success)]">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <h2 className="text-base font-semibold text-[var(--foreground)]">Verification Email Sent</h2>
        </div>
        <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{message}</p>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          For your security and privacy, data requests are processed only after you click the confirmation link sent to your email address.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xs">
      {status === "error" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="text-xs">{message}</AlertDescription>
        </Alert>
      )}

      <Field className="space-y-1.5">
        <FieldLabel htmlFor="privacy-email">
          Email address <span className="text-[var(--destructive)]">*</span>
        </FieldLabel>
        <Input
          id="privacy-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-10 sm:h-9"
        />
        <p className="text-[11px] text-[var(--muted-foreground)]">
          The email associated with your customer account or purchases.
        </p>
      </Field>

      <Field className="space-y-1.5">
        <FieldLabel htmlFor="privacy-kind">
          Request Type <span className="text-[var(--destructive)]">*</span>
        </FieldLabel>
        <SimpleSelect
          id="privacy-kind"
          value={kind}
          onChange={setKind}
          options={PRIVACY_REQUEST_TYPES}
        />
      </Field>

      <Field className="space-y-1.5">
        <FieldLabel htmlFor="privacy-details">Additional Details (Optional)</FieldLabel>
        <Textarea
          id="privacy-details"
          rows={3}
          maxLength={2000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Provide any specific details regarding your request..."
          className="resize-none text-xs"
        />
      </Field>

      <div className="pt-2">
        <Button
          type="submit"
          size="md"
          disabled={status === "submitting"}
          loading={status === "submitting"}
        >
          {status === "submitting" ? "Submitting..." : "Submit Privacy Request"}
        </Button>
      </div>
    </form>
  );
}
