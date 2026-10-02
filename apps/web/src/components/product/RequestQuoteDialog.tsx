"use client";

import React, { useState } from "react";
import type { StorefrontProductDetail, StorefrontVariant } from "@bs/domain";

export interface RequestQuoteDialogProps {
  product: StorefrontProductDetail;
  selectedVariant?: StorefrontVariant | undefined;
  open: boolean;
  onClose: () => void;
}

export function RequestQuoteDialog({
  product,
  selectedVariant,
  open,
  onClose,
}: RequestQuoteDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name");
    if (!email.trim() || !email.includes("@")) return setError("Please enter a valid email address");
    if (quantity < 1) return setError("Quantity must be at least 1");

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/storefront/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          variantId: selectedVariant?.id,
          quantity: Number(quantity),
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          company: company.trim() || undefined,
          message: message.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        throw new Error(body?.message ?? body?.error ?? "Failed to submit quote request. Please try again.");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit quote request");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setError(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quote-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleReset}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground rounded-lg p-1.5 transition-colors"
          aria-label="Close"
        >
          <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {submitted ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 id="quote-modal-title" className="text-xl font-bold text-foreground">
              Quote Request Received
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Thank you, {name}! We have received your request for{" "}
              <strong className="text-foreground">{product.title}</strong>
              {selectedVariant?.title && selectedVariant.title !== "Default"
                ? ` (${selectedVariant.title})`
                : ""}{" "}
              and will respond with custom pricing shortly.
            </p>
            <div className="mt-6">
              <button
                type="button"
                onClick={handleReset}
                className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h2 id="quote-modal-title" className="text-xl font-bold text-foreground">
              Request a Custom Quote
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Submit your inquiry for <strong className="text-foreground">{product.title}</strong>
              {selectedVariant?.title && selectedVariant.title !== "Default"
                ? ` · ${selectedVariant.title}`
                : ""}
              . Our team will review your requirements and send an official quote.
            </p>

            {error && (
              <div role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <label htmlFor="quote-name" className="text-xs font-semibold text-foreground">
                  Your Full Name *
                </label>
                <input
                  id="quote-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <label htmlFor="quote-email" className="text-xs font-semibold text-foreground">
                    Email Address *
                  </label>
                  <input
                    id="quote-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="grid gap-1.5">
                  <label htmlFor="quote-phone" className="text-xs font-semibold text-foreground">
                    Phone Number
                  </label>
                  <input
                    id="quote-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <label htmlFor="quote-company" className="text-xs font-semibold text-foreground">
                    Company / Organization
                  </label>
                  <input
                    id="quote-company"
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Acme Corp"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="grid gap-1.5">
                  <label htmlFor="quote-qty" className="text-xs font-semibold text-foreground">
                    Quantity Required *
                  </label>
                  <input
                    id="quote-qty"
                    type="number"
                    min="1"
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <label htmlFor="quote-msg" className="text-xs font-semibold text-foreground">
                  Additional Notes / Requirements
                </label>
                <textarea
                  id="quote-msg"
                  rows={3}
                  maxLength={2000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Specific customization, timeline, delivery location, or special requests..."
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="mt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {loading ? "Submitting..." : "Submit Quote Request"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
