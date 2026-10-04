"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

interface SubdomainAvailabilityCheckerProps {
  platformDomain?: string;
}

export function SubdomainAvailabilityChecker({
  platformDomain = "bcom.si",
}: SubdomainAvailabilityCheckerProps) {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [slug, setSlug] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    available?: boolean;
    reason?: string;
  } | null>(null);
  const [, startTransition] = useTransition();

  // Slug auto-generation from store name
  const handleStoreNameChange = (name: string) => {
    setStoreName(name);
    const autoSlug = name
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .slice(0, 30);
    setSlug(autoSlug);
  };

  useEffect(() => {
    if (!slug || slug.length < 3) {
      const timer = setTimeout(() => {
        setCheckResult(null);
        setIsChecking(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(async () => {
      setIsChecking(true);
      try {
        const res = await fetch(`/api/saas/subdomain/check?slug=${encodeURIComponent(slug)}`);
        if (res.ok) {
          const data = (await res.json()) as { available: boolean; reason?: string };
          setCheckResult(data);
        } else {
          setCheckResult({ available: false, reason: "Unable to verify availability" });
        }
      } catch {
        setCheckResult({ available: false, reason: "Network error checking subdomain" });
      } finally {
        setIsChecking(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [slug]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || slug.length < 3) return;
    if (checkResult && !checkResult.available) return;

    startTransition(() => {
      router.push(`/signup?slug=${encodeURIComponent(slug)}&storeName=${encodeURIComponent(storeName || slug)}`);
    });
  };

  return (
    <div className="w-full max-w-xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-3xl p-2 sm:flex-row sm:items-center sm:rounded-full" style={{ background: "rgb(255 255 255 / 0.05)", border: "1px solid rgb(255 255 255 / 0.18)" }}>
        <label className="flex flex-1 items-center gap-2 px-4">
          <span className="sr-only">Store name</span>
          <input
            type="text"
            placeholder="Your store name"
            value={storeName}
            onChange={(e) => handleStoreNameChange(e.target.value)}
            className="min-h-[3rem] w-full bg-transparent text-[1.05rem] font-medium outline-none placeholder:opacity-50"
            style={{ color: "var(--bm-text)" }}
            autoComplete="off"
            required
          />
          <span className="shrink-0 text-sm font-semibold" style={{ color: "var(--bm-dim)" }}>.{platformDomain}</span>
        </label>
        <button
          type="submit"
          disabled={checkResult !== null && !checkResult.available}
          className="bm-pill"
        >
          See it in action
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
        </button>
      </form>
      <p className="mt-3 min-h-[1.75rem] text-[0.95rem] font-medium" role="status" aria-live="polite">
        {slug.length >= 3 &&
          (isChecking ? (
            <span style={{ color: "var(--bm-dim)" }}>Checking {slug}.{platformDomain}…</span>
          ) : checkResult?.available ? (
            <span style={{ color: "#7ee8c6" }}>✓ {slug}.{platformDomain} is available</span>
          ) : checkResult ? (
            <span style={{ color: "#ff9db8" }}>{checkResult.reason || "That name is taken"}</span>
          ) : null)}
      </p>
    </div>
  );
}
