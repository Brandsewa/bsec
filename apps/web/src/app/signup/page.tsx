"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { TurnstileWidget } from "@/components/marketing/TurnstileWidget";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { SimpleSelect } from "@bs/ui";
import { formatMoney } from "@bs/contracts/money";
import { postalCodeProblem, regionsFor, POSTAL_LABEL } from "@bs/domain/addresses";
import { INDIAN_STATES } from "@/lib/india";
import { loadGoogleScript } from "@/lib/google-identity.ts";
import { fontSerifDisplay } from "@/lib/fonts.ts";
import { Nav } from "@/components/marketing/landing/sections/Nav.tsx";
import { SiteFooter } from "@/components/marketing/landing/sections/Footer.tsx";
import "@/components/marketing/landing/landing.css";

interface PlanOption {
  code: string;
  name: string;
  priceMonthlyPaise: number;
  priceMonthlyUsdCents?: number | null;
  currency: string;
  limits: Record<string, number>;
  features: Record<string, boolean>;
  tagline?: string | null;
  badge?: string | null;
  /** Card lines saved in Super Admin (Plans), with every limit already filled in. */
  bullets?: string[];
}

interface CompareCell {
  k: "tick" | "none" | "text" | "soon";
  t?: string;
}
interface CompareView {
  plans: Array<{ code: string; name: string }>;
  groups: Array<{ groupName: string; rows: Array<{ label: string; tooltip: string | null; cells: Record<string, CompareCell> }> }>;
}

function compareCellText(c: CompareCell | undefined): string {
  if (!c || c.k === "none") return "-";
  if (c.k === "tick") return "✓";
  if (c.k === "soon") return "Soon";
  return c.t ?? "";
}

/** The long plan comparison, loaded only when the visitor opens it. */
function PlanCompare() {
  const [view, setView] = useState<CompareView | null>(null);
  const [failed, setFailed] = useState(false);
  function load(open: boolean) {
    if (!open || view) return;
    fetch("/api/saas/plan-compare")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((v: CompareView) => setView(v))
      .catch(() => setFailed(true));
  }
  return (
    <details className="mt-3" onToggle={(e) => load((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="bm-dim cursor-pointer text-sm underline">Compare all features</summary>
      {failed && <p className="bm-dim mt-2 text-xs">The comparison could not be loaded.</p>}
      {view && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th className="py-1 pr-3 font-medium" />
                {view.plans.map((p) => (
                  <th key={p.code} className="px-2 py-1 font-semibold">{p.name}</th>
                ))}
              </tr>
            </thead>
            {view.groups.map((g) => (
              <tbody key={g.groupName}>
                <tr>
                  <td colSpan={view.plans.length + 1} className="pt-3 pb-1 text-sm font-semibold">{g.groupName}</td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.label} className="border-t border-white/10">
                    <td className="py-1.5 pr-3" title={r.tooltip ?? undefined}>{r.label}</td>
                    {view.plans.map((p) => (
                      <td key={p.code} className="px-2 py-1.5">{compareCellText(r.cells[p.code])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </details>
  );
}

interface CountryOption {
  iso2: string;
  name: string;
  defaultCurrency: string;
  defaultLocale: string;
  defaultTimezone: string;
  defaultUnitSystem: string;
  addressSchema: string;
  sort: number;
}

const DEFAULT_TRIAL_DAYS = 14;

function formatPlanPrice(plan: PlanOption, country: string): string {
  if (country === "IN") {
    return `${formatMoney(plan.priceMonthlyPaise, "INR")} / mo`;
  }
  const usdCents = plan.priceMonthlyUsdCents ?? Math.round(plan.priceMonthlyPaise / 80);
  return `${formatMoney(usdCents, "USD")} / mo`;
}

/** Card lines saved in Super Admin; plans without saved lines fall back to the enforced limits. */
function planChips(plan: PlanOption): string[] {
  if (plan.bullets && plan.bullets.length > 0) return plan.bullets;
  const chips: string[] = [];
  const fmt = (v: number) => v.toLocaleString("en-US");
  if (plan.limits.products) chips.push(`Up to ${fmt(plan.limits.products)} products`);
  if (plan.limits.staff_seats) chips.push(`${fmt(plan.limits.staff_seats)} staff accounts`);
  return chips;
}

function SignupContent() {
  const searchParams = useSearchParams();

  // Wizard state (Steps 1 to 5)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [showPassword, setShowPassword] = useState(false);
  const [promoCode, setPromoCode] = useState(searchParams.get("promo") || "");

  // Form fields
  const [country, setCountry] = useState<string>("IN");
  const [countries, setCountries] = useState<CountryOption[]>([
    { iso2: "IN", name: "India", defaultCurrency: "INR", defaultLocale: "en-IN", defaultTimezone: "Asia/Kolkata", defaultUnitSystem: "metric", addressSchema: "in", sort: 1 },
    { iso2: "US", name: "United States", defaultCurrency: "USD", defaultLocale: "en-US", defaultTimezone: "America/New_York", defaultUnitSystem: "imperial", addressSchema: "us", sort: 2 },
    { iso2: "CA", name: "Canada", defaultCurrency: "CAD", defaultLocale: "en-CA", defaultTimezone: "America/Toronto", defaultUnitSystem: "metric", addressSchema: "ca", sort: 3 },
  ]);
  const [storeName, setStoreName] = useState(searchParams.get("storeName") || "");
  const [slug, setSlug] = useState(searchParams.get("slug") || "");
  const [slugStatus, setSlugStatus] = useState<{ available?: boolean; reason?: string } | null>(null);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);

  // Lead tracking
  const [leadId, setLeadId] = useState<string | undefined>(undefined);

  // Account
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  // Signup with Google: the verified ticket replaces the password, and the email becomes read-only.
  const [googleTicket, setGoogleTicket] = useState<string | null>(null);
  const [googleCfg, setGoogleCfg] = useState<{ clientId: string } | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  // Business
  const [industry, setIndustry] = useState("retail");
  const [businessName, setBusinessName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [businessCity, setBusinessCity] = useState("");
  const [businessState, setBusinessState] = useState("");
  const [pincode, setPincode] = useState("");

  // Plan (loaded from the platform's real plans) and promo code check
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [plansError, setPlansError] = useState(false);
  // The free trial is a platform setting; 0 means no trial (the store starts restricted until it pays).
  const [trialDays, setTrialDays] = useState(DEFAULT_TRIAL_DAYS);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(searchParams.get("plan"));
  const [promoStatus, setPromoStatus] = useState<{ checking?: boolean; valid?: boolean; message?: string } | null>(null);
  // Set when the bot check cannot run (for example the domain is not allowed on the Turnstile widget).
  const [turnstileFailed, setTurnstileFailed] = useState(false);

  // Submission & Provisioning status
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionProgress, setProvisionProgress] = useState("Initializing store...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bot challenge: the site key comes from the server's runtime config; when unset (local dev) no widget is shown.
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileNonce, setTurnstileNonce] = useState(0); // bumping it remounts the widget for a fresh single-use token
  const [configLoaded, setConfigLoaded] = useState(false);
  const [provisionSuccess, setProvisionSuccess] = useState<{
    storeUrl: string;
    adminUrl: string;
    slug: string;
  } | null>(null);

  // Check and normalize slug
  const handleStoreNameChange = (val: string) => {
    setStoreName(val);
    if (!slug || slug === searchParams.get("slug")) {
      const generated = val
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .slice(0, 30);
      setSlug(generated);
    }
  };

  useEffect(() => {
    if (!slug || slug.length < 3) {
      const timer = setTimeout(() => {
        setSlugStatus(null);
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(async () => {
      setIsCheckingSlug(true);
      try {
        const res = await fetch(`/api/saas/subdomain/check?slug=${encodeURIComponent(slug)}`);
        const data = await res.json();
        setSlugStatus(data);
      } catch {
        setSlugStatus({ available: false, reason: "Error verifying slug availability" });
      } finally {
        setIsCheckingSlug(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [slug]);

  // Persist lead helper
  const updateLead = async (stepName: string, extraData: Record<string, unknown> = {}) => {
    try {
      const res = await fetch("/api/saas/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          email: email || undefined,
          phone: phone || undefined,
          name: ownerName || undefined,
          businessName: storeName || undefined,
          desiredSlug: slug || undefined,
          industry: industry || undefined,
          step: stepName,
          ...extraData,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.leadId) setLeadId(data.leadId);
      }
    } catch {
      // Non-fatal analytics lead saving
    }
  };

  // Step 1 -> Step 2
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || slug.length < 3 || !slugStatus?.available) return;

    // Reserve subdomain
    try {
      const res = await fetch("/api/saas/subdomain/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, leadId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setErrorMessage(data.reason || "Failed to reserve subdomain. Please try another.");
        return;
      }
    } catch {
      // Continue
    }

    setErrorMessage(null);
    await updateLead("subdomain_selected");
    setStep(2);
  };

  // Step 2 -> Step 3
  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleTicket && password.length < 10) {
      setErrorMessage("Password must be at least 10 characters long.");
      return;
    }
    setErrorMessage(null);
    await updateLead("credentials_entered");
    setStep(3);
  };

  // Google sign-up button on step 2 (only when Super Admin enabled it for new store owners).
  useEffect(() => {
    if (step !== 2 || googleTicket) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = (await fetch("/api/public/google-signin").then((r) => (r.ok ? r.json() : null))) as {
          enabled?: boolean;
          clientId?: string | null;
          signupAllowed?: boolean;
        } | null;
        if (cancelled || !cfg?.enabled || !cfg.signupAllowed || !cfg.clientId) return;
        const clientId = cfg.clientId;
        setGoogleCfg({ clientId });
        const { nonce } = (await fetch("/api/saas/google/nonce").then((r) => r.json())) as { nonce: string };
        await loadGoogleScript();
        if (cancelled || !googleButtonRef.current) return;
        window.google?.accounts.id.initialize({
          client_id: clientId,
          nonce,
          use_fedcm_for_prompt: true,
          callback: async (resp: { credential?: string }) => {
            if (!resp.credential) return;
            const res = await fetch("/api/saas/google/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken: resp.credential, nonce }),
            });
            const data = (await res.json().catch(() => ({}))) as { ticket?: string; email?: string; name?: string; error?: string };
            if (!res.ok || !data.ticket) {
              setErrorMessage(data.error || "Google could not be verified. Please try again.");
              return;
            }
            setErrorMessage(null);
            setGoogleTicket(data.ticket);
            if (data.email) setEmail(data.email);
            if (data.name && !ownerName.trim()) setOwnerName(data.name);
          },
        });
        window.google?.accounts.id.renderButton(googleButtonRef.current, { theme: "outline", size: "large", text: "signup_with", width: 320 });
      } catch {
        /* the email and password form always works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, googleTicket]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetch("/api/saas/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { turnstileSiteKey?: string | null } | null) => setTurnstileSiteKey(cfg?.turnstileSiteKey ?? null))
      .catch(() => setTurnstileSiteKey(null))
      .finally(() => setConfigLoaded(true));
  }, []);

  // Step 3 -> Step 4
  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessState) {
      setErrorMessage(country === "IN" ? "Please choose the state your business is in." : country === "US" ? "Please choose your state." : country === "CA" ? "Please choose your province." : "Please choose your state or region.");
      return;
    }
    if (pincode.trim()) {
      const postalErr = postalCodeProblem(country, pincode);
      if (postalErr) {
        setErrorMessage(postalErr);
        return;
      }
    }
    setErrorMessage(null);
    await updateLead("basics_entered", { businessName: businessName.trim() || storeName || undefined });
    setStep(4);
    // A code carried in the link (?promo=) is checked as soon as the plan step opens.
    if (promoCode.trim()) void checkPromo(promoCode, selectedPlan);
  };

  // Load the platform's real plans once. Without a choice in the link, the second plan is preselected as "recommended".
  useEffect(() => {
    fetch("/api/saas/plans")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("plans"))))
      .then((rows: PlanOption[]) => {
        setPlans(rows);
        setSelectedPlan((cur) => (cur && rows.some((p) => p.code === cur) ? cur : (rows[Math.min(1, rows.length - 1)]?.code ?? null)));
      })
      .catch(() => setPlansError(true));
  }, []);

  // Load supported platform countries
  useEffect(() => {
    fetch("/api/saas/countries")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("countries"))))
      .then((rows: CountryOption[]) => {
        if (rows && rows.length > 0) setCountries(rows);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/saas/trial")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("trial"))))
      .then((t: { days?: number }) => {
        if (typeof t.days === "number") setTrialDays(t.days);
      })
      .catch(() => undefined);
  }, []);

  const checkPromo = async (code: string, planCode: string | null) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setPromoStatus(null);
      return;
    }
    setPromoStatus({ checking: true });
    try {
      const res = await fetch("/api/saas/promo/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed, planCode }),
      });
      const data = (await res.json()) as { valid?: boolean; message?: string };
      setPromoStatus({ valid: Boolean(data.valid), message: data.message ?? "Could not check this code." });
    } catch {
      setPromoStatus({ valid: false, message: "Could not check this code. Try again." });
    }
  };

  // Step 5 Submit: Final Provisioning
  const handleFinalSubmit = async () => {
    if (!selectedPlan) {
      setErrorMessage("Please choose a plan.");
      return;
    }
    if (promoCode.trim() && !promoStatus?.valid) {
      setErrorMessage("Fix or clear the promo code before launching.");
      return;
    }
    setIsProvisioning(true);
    setErrorMessage(null);
    setProvisionProgress("Creating tenant database isolation...");

    const selectedCountryCfg = countries.find((c) => c.iso2 === country);
    const countryName = selectedCountryCfg?.name || country;
    const steps = [
      `Configuring ${countryName} shipping zones & base market...`,
      country === "IN" ? "Setting up Cash on Delivery & payment configurations..." : "Setting up payment configurations...",
      "Publishing starter theme template & home page blocks...",
      trialDays > 0 ? `Allocating size tier & starting ${trialDays}-day free trial...` : "Allocating size tier & setting up your plan...",
    ];

    let stepIndex = 0;
    const progressTimer = setInterval(() => {
      const nextStep = steps[stepIndex];
      if (nextStep) {
        setProvisionProgress(nextStep);
        stepIndex++;
      }
    }, 400);

    try {
      const res = await fetch("/api/saas/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          turnstileToken: turnstileToken ?? undefined,
          storeName: storeName.trim() || `${slug} Store`,
          slug: slug.trim(),
          country,
          owner: {
            email: email.trim(),
            name: ownerName.trim(),
            ...(googleTicket ? { googleTicket } : { password }),
            phone: phone.trim() || undefined,
          },
          planCode: selectedPlan,
          ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
          business: {
            legalName: businessName.trim() || undefined,
            industry,
            line1: addressLine.trim() || undefined,
            city: businessCity.trim() || undefined,
            state: businessState || undefined,
            pincode: pincode.trim() || undefined,
          },
        }),
      });

      clearInterval(progressTimer);

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to provision store. Please try again.");
      }

      const result = await res.json();
      setProvisionProgress("Store successfully created!");
      setProvisionSuccess({
        storeUrl: result.storeUrl,
        adminUrl: result.adminUrl,
        slug: result.slug,
      });
    } catch (err: unknown) {
      clearInterval(progressTimer);
      setIsProvisioning(false);
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred during store creation.");
      setTurnstileToken(null);
      setTurnstileNonce((n) => n + 1);
    }
  };

  if (provisionSuccess) {
    return (
      <div className="relative mx-auto max-w-xl px-4 pb-16 text-center">
        <div className="bm-su-tick mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="bm-h2 mb-3">Your store is live!</h2>
        <p className="bm-dim mb-8 leading-relaxed">
          Your new online store <strong>{storeName}</strong> has been provisioned and is ready to take orders.
        </p>

        <div className="bm-panel mb-8 space-y-4 p-6 text-left">
          <div>
            <span className="bm-label">Live Storefront URL</span>
            <div className="bm-code mt-1" style={{ color: "#7ee8c6" }}>
              <a href={provisionSuccess.storeUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity">
                {provisionSuccess.storeUrl}
              </a>
            </div>
          </div>
          <div>
            <span className="bm-label">Store Admin Dashboard</span>
            <div className="bm-code mt-1">
              <a href={`${provisionSuccess.adminUrl}/?store=${provisionSuccess.slug}`} target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity">
                {provisionSuccess.adminUrl}/?store={provisionSuccess.slug}
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href={`${provisionSuccess.adminUrl}/?store=${provisionSuccess.slug}`}
            className="bm-pill"
          >
            Open Store Admin
          </a>
          <a
            href={provisionSuccess.storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bm-outline justify-center px-6"
          >
            Visit Live Storefront
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-2xl px-4 pb-14 sm:px-6">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="su-title">
          Create your <i>online store</i>
        </h1>
        <p className="bm-dim mt-3 text-sm">{trialDays > 0 ? `${trialDays}-day free trial · ` : ""}Setup takes 2 minutes</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between mb-8 px-2 max-w-md mx-auto">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s
                  ? "bm-step-on"
                  : step > s
                  ? "bm-step-done"
                  : "bm-step-off"
              }`}
            >
              {step > s ? "✓" : s}
            </div>
            {s < 5 && (
              <div
                className={`w-6 sm:w-10 h-0.5 mx-1 transition-all ${
                  step > s ? "bm-line-on" : "bm-line-off"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div className="bm-alert mb-6 flex items-start gap-3 p-4 text-sm">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1 font-medium">{errorMessage}</div>
        </div>
      )}

      {/* Wizard Card */}
      <div className="bm-su-card p-6 sm:p-10">
        {/* Step 1: Subdomain & Store Name */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="space-y-6">
            <div>
              <h2 className="mb-1 text-xl font-semibold">Step 1: Choose your store address</h2>
              <p className="bm-dim text-sm">Pick your country, store name and claim your permanent subdomain.</p>
            </div>

            <div>
              <label className="bm-label">
                Country
              </label>
              <SimpleSelect
                value={country}
                onChange={(c) => {
                  setCountry(c);
                  setBusinessState("");
                  setPincode("");
                }}
                options={countries.map((c) => ({ value: c.iso2, label: `${c.name} (${c.defaultCurrency})` }))}
              />
              <p className="bm-dim mt-1 text-xs">Sets your store currency, timezone and base shipping market.</p>
            </div>

            <div>
              <label className="bm-label">
                Store Name
              </label>
              <input
                type="text"
                placeholder={country === "IN" ? "e.g. Kolkata Handlooms" : country === "US" ? "e.g. Brooklyn Roasters" : "e.g. Montreal Organics"}
                value={storeName}
                onChange={(e) => handleStoreNameChange(e.target.value)}
                className="bm-input"
                required
              />
            </div>

            <div>
              <label className="bm-label">
                Subdomain Address
              </label>
              <div className="bm-input bm-input-group">
                <input
                  type="text"
                  placeholder="store-name"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
                  className="w-full bg-transparent font-mono text-sm outline-none"
                  required
                />
                <span className="bm-dim shrink-0 select-none pl-2 text-sm font-medium">
                  .bcom.si
                </span>
              </div>
              <div className="mt-2 text-xs font-medium">
                {isCheckingSlug ? (
                  <span className="bm-dim">Checking availability...</span>
                ) : slugStatus?.available ? (
                  <span style={{ color: "#7ee8c6" }}>✓ {slug}.bcom.si is available</span>
                ) : slugStatus ? (
                  <span style={{ color: "#ff9db8" }}>✕ {slugStatus.reason || "Subdomain is unavailable"}</span>
                ) : (
                  <span className="bm-dim">At least 3 characters. Lowercase letters, numbers, and hyphens.</span>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={!slug || slug.length < 3 || !slugStatus?.available}
              className="bm-pill w-full"
            >
              Continue to Account
            </button>
          </form>
        )}

        {/* Step 2: Account Details */}
        {step === 2 && (
          <form onSubmit={handleStep2Submit} className="space-y-6">
            <div>
              <h2 className="mb-1 text-xl font-semibold">Step 2: Store Owner Account</h2>
              <p className="bm-dim text-sm">These credentials will be used to log into your merchant admin.</p>
            </div>

            {googleCfg && !googleTicket ? (
              <div className="space-y-3">
                <div ref={googleButtonRef} />
                <p className="bm-dim text-xs">or fill in the form below</p>
              </div>
            ) : null}
            {googleTicket ? (
              <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                Google verified {email}. No password is needed: you will sign in with Google.
              </p>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="bm-label">
                  Your Full Name
                </label>
                <input
                  type="text"
                  placeholder="Aarav Sharma"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="bm-input"
                  required
                />
              </div>

              <div>
                <label className="bm-label">
                  Mobile Number (Optional)
                </label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="bm-input"
                />
              </div>
            </div>

            <div>
              <label className="bm-label">
                Business Email Address
              </label>
              <input
                type="email"
                placeholder="founder@yourstore.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bm-input"
                required
                readOnly={Boolean(googleTicket)}
              />
              <p className="bm-dim mt-1 text-xs">Must be a valid business or personal email (no disposable addresses).</p>
            </div>

            {!googleTicket ? (
            <div>
              <label className="bm-label">
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 10 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bm-input"
                  style={{ paddingRight: "3rem" }}
                  autoComplete="new-password"
                  required
                  minLength={10}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "3rem", background: "transparent", border: 0, color: "inherit", opacity: 0.7, cursor: "pointer", fontSize: "0.75rem" }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            ) : null}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="bm-outline px-6"
              >
                Back
              </button>
              <button
                type="submit"
                className="bm-pill flex-1"
              >
                Continue
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Business Details */}
        {step === 3 && (
          <form onSubmit={handleStep3Submit} className="space-y-6">
            <div>
              <h2 className="mb-1 text-xl font-semibold">Step 3: Tell us about your business</h2>
              <p className="bm-dim text-sm">
                {country === "IN"
                  ? "This pre-fills your store details, invoices and GST state. You can change it later in Settings."
                  : "This pre-fills your store details and business address. You can change it later in Settings."}
              </p>
            </div>

            <div>
              <label className="bm-label">Business name</label>
              <input
                type="text"
                placeholder={storeName || "Your registered business name"}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="bm-input"
              />
              <p className="bm-dim mt-1 text-xs">Leave empty to use your store name.</p>
            </div>

            <div>
              <label className="bm-label">Industry category</label>
              <SimpleSelect
                value={industry}
                onChange={setIndustry}
                options={[
                  { value: "retail", label: "General Retail & Lifestyle" },
                  { value: "fashion", label: "Fashion & Apparel" },
                  { value: "food", label: "Gourmet Food & Beverages" },
                  { value: "handicrafts", label: "Handicrafts & Artisans" },
                  { value: "beauty", label: "Beauty & Personal Care" },
                  { value: "electronics", label: "Electronics & Accessories" },
                ]}
              />
            </div>

            <div>
              <label className="bm-label">Business address</label>
              <input
                type="text"
                placeholder="Building, street, area"
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                className="bm-input"
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="bm-label">City</label>
                <input
                  type="text"
                  placeholder={country === "IN" ? "e.g. Mumbai" : country === "US" ? "e.g. Austin" : "e.g. Toronto"}
                  value={businessCity}
                  onChange={(e) => setBusinessCity(e.target.value)}
                  className="bm-input"
                  required
                />
              </div>
              <div>
                <label className="bm-label">{country === "CA" ? "Province" : "State"}</label>
                {country === "IN" ? (
                  <SimpleSelect
                    value={businessState}
                    onChange={setBusinessState}
                    placeholder="Select state"
                    options={INDIAN_STATES.map((st) => ({ value: st, label: st }))}
                  />
                ) : regionsFor(country).length > 0 ? (
                  <SimpleSelect
                    value={businessState}
                    onChange={setBusinessState}
                    placeholder={country === "CA" ? "Select province" : "Select state"}
                    options={regionsFor(country).map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }))}
                  />
                ) : (
                  <input
                    type="text"
                    placeholder="State or Region"
                    value={businessState}
                    onChange={(e) => setBusinessState(e.target.value)}
                    className="bm-input"
                    required
                  />
                )}
              </div>
            </div>

            <div>
              <label className="bm-label">
                {POSTAL_LABEL[country] ? `${POSTAL_LABEL[country].charAt(0).toUpperCase() + POSTAL_LABEL[country].slice(1)} (optional)` : "Postal code (optional)"}
              </label>
              <input
                type="text"
                placeholder={country === "IN" ? "400001" : country === "US" ? "90210" : "M5V 2T6"}
                value={pincode}
                onChange={(e) => {
                  const val = e.target.value;
                  if (country === "IN") {
                    setPincode(val.replace(/\D/g, "").slice(0, 6));
                  } else {
                    setPincode(val.slice(0, 10));
                  }
                }}
                className="bm-input"
              />
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)} className="bm-outline px-6">
                Back
              </button>
              <button type="submit" className="bm-pill flex-1">
                Continue to Plan
              </button>
            </div>
          </form>
        )}

        {/* Step 4: Plan Selection & Provisioning */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-1 text-xl font-semibold">Step 4: Choose your plan & launch</h2>
              <p className="bm-dim text-sm">{trialDays > 0 ? `Every plan includes a ${trialDays}-day free trial. Upgrade or cancel anytime.` : "Choose your plan. You pay to unlock it; cancel anytime."}</p>
            </div>

            {plansError && <p className="text-sm" style={{ color: "#ff8a8a" }}>Plans could not be loaded. Refresh the page to try again.</p>}
            {!plans && !plansError && <p className="bm-dim text-sm">Loading plans...</p>}

            <div className="space-y-3">
              {(plans ?? []).map((plan) => (
                <div
                  key={plan.code}
                  onClick={() => {
                    setSelectedPlan(plan.code);
                    // A code can be limited to certain plans, so re-check it for the new choice.
                    if (promoCode.trim()) void checkPromo(promoCode, plan.code);
                  }}
                  className={`bm-opt cursor-pointer p-4 sm:p-5 ${selectedPlan === plan.code ? "is-on" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-base">{plan.name}</h4>
                      {plan.badge ? <span className="bm-badge">{plan.badge}</span> : null}
                    </div>
                    <span className="font-semibold text-base">{formatPlanPrice(plan, country)}</span>
                  </div>
                  {plan.tagline ? <p className="bm-dim mb-2 text-xs">{plan.tagline}</p> : null}
                  <div className="bm-dim flex flex-wrap gap-2 text-[11px] font-medium">
                    {planChips(plan).map((f) => (
                      <span key={f} className="bm-chip">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <PlanCompare />

            <div>
              <label className="bm-label">Promo code (optional)</label>
              <input
                type="text"
                placeholder="e.g. LAUNCH2026"
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value);
                  setPromoStatus(null);
                }}
                onBlur={() => void checkPromo(promoCode, selectedPlan)}
                className="bm-input"
                autoComplete="off"
                maxLength={32}
              />
              {promoStatus && (
                <p
                  className="mt-1 text-xs"
                  role="status"
                  style={{ color: promoStatus.checking ? undefined : promoStatus.valid ? "#7ee8c6" : "#ff8a8a" }}
                >
                  {promoStatus.checking ? "Checking code..." : promoStatus.message}
                </p>
              )}
            </div>

            <div className="bm-panel bm-dim space-y-1 p-4 text-xs">
              <div className="font-semibold">Launch Summary:</div>
              <div>• Store: <strong>{storeName}</strong> ({slug}.bcom.si)</div>
              <div>• Owner: <strong>{email}</strong></div>
              <div>• {trialDays > 0 ? <>Trial: <strong>{trialDays} days free</strong> on</> : <>Plan:</>} <strong>{plans?.find((p) => p.code === selectedPlan)?.name ?? "your chosen"}</strong> plan</div>
              <div>• Location: {[businessCity, businessState].filter(Boolean).join(", ")}</div>
            </div>

            {turnstileSiteKey && (
              <div className="flex justify-center">
                <TurnstileWidget
                  key={turnstileNonce}
                  siteKey={turnstileSiteKey}
                  onToken={setTurnstileToken}
                  onFailure={() => setTurnstileFailed(true)}
                />
              </div>
            )}
            {turnstileFailed && (
              <p className="text-sm" style={{ color: "#ff8a8a" }}>
                The security check could not load, so the store cannot be created yet. Refresh the page; if it keeps happening, contact support.
              </p>
            )}
            <p className="su-consent">
              By launching your store you agree to our <Link href="/terms">Terms of service</Link> and <Link href="/privacy">Privacy policy</Link>. See the{" "}
              <Link href="/refund-policy">refund and cancellation policy</Link>.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={isProvisioning}
                onClick={() => setStep(3)}
                className="bm-outline px-6 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={isProvisioning || !configLoaded || !selectedPlan || (turnstileSiteKey !== null && !turnstileToken)}
                onClick={handleFinalSubmit}
                className="bm-pill bm-wrap flex-1"
              >
                {isProvisioning ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>{provisionProgress}</span>
                  </>
                ) : (
                  <span>{trialDays > 0 ? "Launch My Store Now" : "Create my account and pay"}</span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <div className={`lp lp-su ${fontSerifDisplay.variable}`}>
      <div className="aurora" aria-hidden="true"><i /><i /><i /></div>
      <Nav />
      <div className="su-main">
        <Suspense fallback={<div className="bm-dim p-12 text-center font-medium">Loading signup wizard...</div>}>
          <SignupContent />
        </Suspense>
      </div>
      <SiteFooter />
    </div>
  );
}
