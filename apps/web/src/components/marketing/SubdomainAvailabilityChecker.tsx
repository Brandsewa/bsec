"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

interface SubdomainAvailabilityCheckerProps {
  platformDomain?: string;
}

export function SubdomainAvailabilityChecker({
  platformDomain = "gobs.cloud",
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
    <div className="w-full max-w-xl mx-auto">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 shadow-lg rounded-2xl bg-white p-2.5 border border-slate-200">
        <div className="flex-1 flex items-center px-4 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-emerald-600 focus-within:bg-white transition-all">
          <input
            type="text"
            placeholder="Enter store name..."
            value={storeName}
            onChange={(e) => handleStoreNameChange(e.target.value)}
            className="w-full bg-transparent text-slate-900 placeholder:text-slate-400 font-medium text-base outline-none"
            aria-label="Store name"
            required
          />
          <span className="text-slate-400 font-medium text-sm select-none shrink-0 pl-2">
            .{platformDomain}
          </span>
        </div>

        <button
          type="submit"
          disabled={!slug || slug.length < 3 || (checkResult !== null && !checkResult.available)}
          className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl shadow-md hover:shadow-lg transition-all duration-200 shrink-0 text-center"
        >
          Start Free Trial
        </button>
      </form>

      {/* Subdomain status pill */}
      {slug.length >= 3 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium">
          {isChecking ? (
            <span className="text-slate-500 animate-pulse">Checking {slug}.{platformDomain}...</span>
          ) : checkResult?.available ? (
            <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full flex items-center gap-1.5">
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <strong>{slug}.{platformDomain}</strong> is available!
            </span>
          ) : checkResult ? (
            <span className="text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full flex items-center gap-1.5">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {checkResult.reason || "Subdomain is unavailable"}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
