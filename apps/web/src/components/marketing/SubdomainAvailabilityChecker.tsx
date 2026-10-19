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
    <div className="claimcol">
      <div className="claimw">
        <form className="claim" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="your-store-name"
            aria-label="Store name"
            value={storeName}
            onChange={(e) => handleStoreNameChange(e.target.value)}
            autoComplete="off"
            required
          />
          <span aria-hidden="true">.{platformDomain}</span>
          <button type="submit" className="btn pri" disabled={checkResult !== null && !checkResult.available}>
            Claim it →
          </button>
        </form>
      </div>
      <p className="claimstatus" role="status" aria-live="polite">
        {slug.length >= 3 &&
          (isChecking ? (
            <span className="chk">Checking {slug}.{platformDomain}…</span>
          ) : checkResult?.available ? (
            <span className="ok">✓ {slug}.{platformDomain} is available</span>
          ) : checkResult ? (
            <span className="bad">{checkResult.reason || "That name is taken"}</span>
          ) : null)}
      </p>
    </div>
  );
}
