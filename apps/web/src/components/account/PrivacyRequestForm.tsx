"use client";

import React, { useState } from "react";

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
        body: JSON.stringify({ email, kind, details: details || undefined }),
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
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center space-x-3 text-green-600 dark:text-green-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <h2 className="text-lg font-semibold text-foreground">Verification Email Sent</h2>
        </div>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">
          For your security and privacy, data requests are processed only after you click the confirmation link sent to your email address.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      {status === "error" && (
        <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          {message}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-foreground">
          Email address <span className="text-destructive">*</span>
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          The email associated with your customer account or purchases.
        </p>
      </div>

      <div>
        <label htmlFor="kind" className="block text-sm font-medium text-foreground">
          Request Type <span className="text-destructive">*</span>
        </label>
        <select
          id="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="access">Access data (Export personal information)</option>
          <option value="correction">Correction of personal data</option>
          <option value="erasure">Erasure / Deletion of personal data</option>
          <option value="withdraw_consent">Withdraw marketing consent</option>
          <option value="grievance">Privacy grievance / inquiry</option>
        </select>
      </div>

      <div>
        <label htmlFor="details" className="block text-sm font-medium text-foreground">
          Additional Details (Optional)
        </label>
        <textarea
          id="details"
          rows={3}
          maxLength={2000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Provide any specific details regarding your request..."
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex justify-center rounded-md border border-transparent bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50"
        >
          {status === "submitting" ? "Submitting..." : "Submit Privacy Request"}
        </button>
      </div>
    </form>
  );
}
