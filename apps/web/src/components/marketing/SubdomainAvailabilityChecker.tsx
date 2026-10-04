"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

interface SubdomainAvailabilityCheckerProps {
  platformDomain?: string;
  /** "block" = Block-Print Bazaar (design 1), "ledger" = Bahi-Khata (design 2), "riso" = Riso Zine (design 3), "neo" = Neubrutalist Grid (design 4), "sky" = Night Sky (design 5). */
  variant?: "block" | "ledger" | "riso" | "neo" | "sky";
}

export function SubdomainAvailabilityChecker({
  platformDomain = "bcom.si",
  variant = "block",
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

  if (variant === "sky") {
    return (
      <div className="w-full max-w-xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-2xl p-2.5 sm:flex-row sm:items-center" style={{ background: "var(--sk-panel)", border: "1px solid rgb(190 200 255 / 0.32)" }}>
          <label className="flex flex-1 items-center gap-2 px-3">
            <span className="sr-only">Store name</span>
            <input
              type="text"
              placeholder="Your store name"
              value={storeName}
              onChange={(e) => handleStoreNameChange(e.target.value)}
              className="min-h-[3rem] w-full bg-transparent text-lg font-medium outline-none placeholder:opacity-50"
              style={{ color: "var(--sk-text)" }}
              autoComplete="off"
              required
            />
            <span className="shrink-0 text-sm font-semibold" style={{ color: "var(--sk-dim)" }}>.{platformDomain}</span>
          </label>
          <button
            type="submit"
            disabled={!slug || slug.length < 3 || (checkResult !== null && !checkResult.available)}
            className="sk-btn"
          >
            Start free trial
          </button>
        </form>
        <p className="mt-3 min-h-[1.75rem] text-[0.98rem] font-medium" role="status" aria-live="polite">
          {slug.length >= 3 &&
            (isChecking ? (
              <span style={{ color: "var(--sk-dim)" }}>Checking {slug}.{platformDomain}…</span>
            ) : checkResult?.available ? (
              <span style={{ color: "var(--sk-teal)" }}>✓ {slug}.{platformDomain} is available</span>
            ) : checkResult ? (
              <span style={{ color: "#ff9db8" }}>{checkResult.reason || "That name is taken"}</span>
            ) : null)}
        </p>
      </div>
    );
  }

  if (variant === "neo") {
    return (
      <div className="w-full max-w-xl">
        <form onSubmit={handleSubmit} className="nb-box flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
          <label className="nb-flat flex flex-1 items-center gap-2 bg-[var(--nb-bg)] px-3">
            <span className="sr-only">Store name</span>
            <input
              type="text"
              placeholder="Your store name"
              value={storeName}
              onChange={(e) => handleStoreNameChange(e.target.value)}
              className="min-h-[3rem] w-full bg-transparent text-lg font-bold outline-none placeholder:opacity-45"
              style={{ color: "var(--nb-ink)" }}
              autoComplete="off"
              required
            />
            <span className="shrink-0 text-sm font-bold">.{platformDomain}</span>
          </label>
          <button
            type="submit"
            disabled={!slug || slug.length < 3 || (checkResult !== null && !checkResult.available)}
            className="nb-btn nb-btn-pink"
          >
            Start free trial
          </button>
        </form>
        <p className="mt-3 min-h-[2rem] text-[0.98rem] font-bold" role="status" aria-live="polite">
          {slug.length >= 3 &&
            (isChecking ? (
              <span className="nb-flat bg-white px-2 py-0.5">Checking {slug}.{platformDomain}…</span>
            ) : checkResult?.available ? (
              <span className="nb-flat nb-l px-2 py-0.5">{slug}.{platformDomain} is available</span>
            ) : checkResult ? (
              <span className="nb-flat nb-p px-2 py-0.5">{checkResult.reason || "That name is taken"}</span>
            ) : null)}
        </p>
      </div>
    );
  }

  if (variant === "riso") {
    return (
      <div className="w-full max-w-xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 bg-white p-3 sm:flex-row sm:items-center" style={{ border: "2.5px solid var(--rz-ink)", borderRadius: "1.2rem" }}>
          <label className="flex flex-1 items-center gap-2 px-2">
            <span className="sr-only">Store name</span>
            <input
              type="text"
              placeholder="Your store name"
              value={storeName}
              onChange={(e) => handleStoreNameChange(e.target.value)}
              className="min-h-[3rem] w-full bg-transparent text-lg font-semibold outline-none placeholder:opacity-45"
              style={{ color: "var(--rz-ink)" }}
              autoComplete="off"
              required
            />
            <span className="shrink-0 text-sm font-bold" style={{ color: "var(--rz-blue)" }}>.{platformDomain}</span>
          </label>
          <button
            type="submit"
            disabled={!slug || slug.length < 3 || (checkResult !== null && !checkResult.available)}
            className="rz-btn"
          >
            Start free trial
          </button>
        </form>
        <p className="rz-scrawl mt-2 min-h-[2rem] text-2xl" style={{ lineHeight: 1 }} role="status" aria-live="polite">
          {slug.length >= 3 &&
            (isChecking ? (
              <span className="rz-soft">checking {slug}.{platformDomain}…</span>
            ) : checkResult?.available ? (
              <span style={{ color: "#0a7a43" }}>yes! {slug}.{platformDomain} is free</span>
            ) : checkResult ? (
              <span style={{ color: "#c2127a" }}>{checkResult.reason || "that name is taken"}</span>
            ) : null)}
        </p>
      </div>
    );
  }

  if (variant === "ledger") {
    return (
      <div className="w-full max-w-xl">
        <form onSubmit={handleSubmit} className="bk-paper bk-corners rounded-md p-3 sm:p-4" style={{ ["--bk-m" as string]: "1.1rem" } as React.CSSProperties}>
          <label className="block">
            <span className="bk-muted block pb-1 text-[0.85rem] font-semibold uppercase tracking-wider">Name of your firm</span>
            <span className="flex items-end gap-2 border-b-2 pb-1" style={{ borderColor: "var(--bk-ink)" }}>
              <input
                type="text"
                placeholder="e.g. Kolkata Handlooms"
                value={storeName}
                onChange={(e) => handleStoreNameChange(e.target.value)}
                className="bk-pen min-h-[2.75rem] w-full bg-transparent text-[1.35rem] outline-none placeholder:opacity-50"
                style={{ color: "var(--bk-ink)" }}
                autoComplete="off"
                required
              />
              <span className="shrink-0 pb-2 text-sm font-semibold" style={{ color: "var(--bk-ink-soft)" }}>.{platformDomain}</span>
            </span>
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="submit"
              disabled={!slug || slug.length < 3 || (checkResult !== null && !checkResult.available)}
              className="bk-btn"
            >
              Open my khata
            </button>
            <p className="bk-pen min-h-[1.6rem] text-[1.05rem]" style={{ color: "var(--bk-ink)" }} role="status" aria-live="polite">
              {slug.length >= 3 &&
                (isChecking ? (
                  <span className="bk-muted">Checking {slug}.{platformDomain}…</span>
                ) : checkResult?.available ? (
                  <span style={{ color: "#1f5a2c" }}>✓ {slug}.{platformDomain} is free</span>
                ) : checkResult ? (
                  <span style={{ color: "#9a1f1a" }}>{checkResult.reason || "That name is taken"}</span>
                ) : null)}
            </p>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl">
      <form
        onSubmit={handleSubmit}
        className="bz-cotton flex flex-col gap-3 rounded-2xl p-2.5 sm:flex-row"
        style={{ boxShadow: "0 18px 34px -18px rgb(0 0 0 / 0.6)" }}
      >
        <label className="flex flex-1 items-center rounded-xl px-4 py-1" style={{ background: "rgb(20 28 85 / 0.07)" }}>
          <span className="sr-only">Store name</span>
          <input
            type="text"
            placeholder="Your store name"
            value={storeName}
            onChange={(e) => handleStoreNameChange(e.target.value)}
            className="min-h-[3rem] w-full bg-transparent text-base font-semibold outline-none"
            style={{ color: "#141c55" }}
            autoComplete="off"
            required
          />
          <span className="shrink-0 pl-2 text-sm font-semibold select-none" style={{ color: "#4a5083" }}>
            .{platformDomain}
          </span>
        </label>
        <button
          type="submit"
          disabled={!slug || slug.length < 3 || (checkResult !== null && !checkResult.available)}
          className="bz-btn sm:min-w-[11rem]"
        >
          Start free trial
        </button>
      </form>

      <div className="mt-3 min-h-[2rem] text-[0.95rem] font-medium" role="status" aria-live="polite">
        {slug.length >= 3 &&
          (isChecking ? (
            <span style={{ color: "var(--bz-cotton-dim)" }}>Checking {slug}.{platformDomain}…</span>
          ) : checkResult?.available ? (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1" style={{ background: "var(--bz-indigo-deep)", color: "var(--bz-turmeric)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
              <strong>{slug}.{platformDomain}</strong> is available
            </span>
          ) : checkResult ? (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1" style={{ background: "var(--bz-indigo-deep)", color: "var(--bz-madder-bright)" }}>
              {checkResult.reason || "That name is not available"}
            </span>
          ) : null)}
      </div>
    </div>
  );
}
