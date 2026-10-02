"use client";

import React, { useState, useEffect, Suspense } from "react";
import { TurnstileWidget } from "@/components/marketing/TurnstileWidget";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface TemplateOption {
  code: string;
  name: string;
  industry: string;
  description: string;
}

const TEMPLATES: TemplateOption[] = [
  {
    code: "starter-minimal",
    name: "Minimalist Essential",
    industry: "Handicrafts & General Retail",
    description: "Clean typography, fast product grids, and distraction-free mobile checkout.",
  },
  {
    code: "fashion-editorial",
    name: "Fashion Editorial",
    industry: "Apparel & Accessories",
    description: "Lookbook hero banners, lifestyle collections, and size/variant switchers.",
  },
  {
    code: "gourmet-artisan",
    name: "Gourmet Artisan",
    industry: "Food, Tea & Organic Goods",
    description: "Warm organic palette with custom freshness badges and ingredient highlights.",
  },
];

const PLANS = [
  {
    code: "starter",
    name: "Starter",
    priceText: "₹999 / mo",
    trialDays: 14,
    description: "Ideal for boutique businesses and emerging creators.",
    features: ["Up to 500 products", "2 staff accounts", "₹99 Flat Rate India shipping", "1 Custom Domain"],
  },
  {
    code: "growth",
    name: "Growth",
    priceText: "₹2,499 / mo",
    trialDays: 14,
    popular: true,
    description: "For scaling Indian brands with fast-moving inventory.",
    features: ["Up to 5,000 products", "5 staff accounts", "3 Custom Domains", "Shiprocket automation", "Remove platform branding"],
  },
  {
    code: "pro",
    name: "Pro",
    priceText: "₹5,999 / mo",
    trialDays: 14,
    description: "High-volume brands needing multi-location scale.",
    features: ["Up to 25,000 products", "15 staff accounts", "10 Custom Domains", "High-concurrency protection"],
  },
];

function SignupContent() {
  const searchParams = useSearchParams();

  // Wizard state (Steps 1 to 5)
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Form fields
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

  // Business
  const [industry, setIndustry] = useState("retail");
  const [businessCity, setBusinessCity] = useState("");

  // Template & Plan
  const [selectedTemplate, setSelectedTemplate] = useState(searchParams.get("template") || "starter-minimal");
  const [selectedPlan, setSelectedPlan] = useState(searchParams.get("plan") || "growth");

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
    if (password.length < 10) {
      setErrorMessage("Password must be at least 10 characters long.");
      return;
    }
    setErrorMessage(null);
    await updateLead("credentials_entered");
    setStep(3);
  };

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
    setErrorMessage(null);
    await updateLead("basics_entered");
    setStep(4);
  };

  // Step 4 -> Step 5
  const handleStep4Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    await updateLead("template_chosen");
    setStep(5);
  };

  // Step 5 Submit: Final Provisioning
  const handleFinalSubmit = async () => {
    setIsProvisioning(true);
    setErrorMessage(null);
    setProvisionProgress("Creating tenant database isolation...");

    const steps = [
      "Configuring India shipping zones (₹99 standard flat rate)...",
      "Setting up Cash on Delivery & payment configurations...",
      "Publishing starter theme template & home page blocks...",
      "Allocating size tier & starting 14-day free trial...",
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
          owner: {
            email: email.trim(),
            name: ownerName.trim(),
            password,
            phone: phone.trim() || undefined,
          },
          planCode: selectedPlan,
          themeTemplate: selectedTemplate,
          currency: "INR",
          timezone: "Asia/Kolkata",
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
      <div className="max-w-xl mx-auto py-16 px-4 text-center">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 mb-3">Your store is live!</h2>
        <p className="text-slate-600 mb-8 leading-relaxed">
          Your new online store <strong>{storeName}</strong> has been provisioned and is ready to take orders.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 mb-8 text-left space-y-4">
          <div>
            <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Live Storefront URL</span>
            <div className="mt-1 font-mono text-emerald-800 font-bold bg-white px-3 py-2 rounded-lg border border-slate-200">
              <a href={provisionSuccess.storeUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {provisionSuccess.storeUrl}
              </a>
            </div>
          </div>
          <div>
            <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">Store Admin Dashboard</span>
            <div className="mt-1 font-mono text-slate-800 font-bold bg-white px-3 py-2 rounded-lg border border-slate-200">
              <a href={`${provisionSuccess.adminUrl}/?store=${provisionSuccess.slug}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {provisionSuccess.adminUrl}/?store={provisionSuccess.slug}
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href={`${provisionSuccess.adminUrl}/?store=${provisionSuccess.slug}`}
            className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all text-center"
          >
            Open Store Admin
          </a>
          <a
            href={provisionSuccess.storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold rounded-xl transition-all text-center"
          >
            Visit Live Storefront
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 sm:px-6">
      {/* Header */}
      <div className="text-center mb-10">
        <Link href="/" className="inline-flex items-center gap-2 mb-6">
          <span className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-black text-lg">
            g
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            bcom<span className="text-emerald-600">.si</span>
          </span>
        </Link>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Create your online store
        </h1>
        <p className="text-slate-600 text-sm mt-1">14-day free trial · Setup takes 2 minutes</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between mb-8 px-2 max-w-md mx-auto">
        {[1, 2, 3, 4, 5].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                  : step > s
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {step > s ? "✓" : s}
            </div>
            {s < 5 && (
              <div
                className={`w-6 sm:w-10 h-0.5 mx-1 transition-all ${
                  step > s ? "bg-emerald-500" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3">
          <svg className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1 font-medium">{errorMessage}</div>
        </div>
      )}

      {/* Wizard Card */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-6 sm:p-10">
        {/* Step 1: Subdomain & Store Name */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Step 1: Choose your store address</h2>
              <p className="text-sm text-slate-500">Pick your store name and claim your permanent subdomain.</p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Store Name
              </label>
              <input
                type="text"
                placeholder="e.g. Kolkata Handlooms"
                value={storeName}
                onChange={(e) => handleStoreNameChange(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 outline-none text-base"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Subdomain Address
              </label>
              <div className="flex items-center px-4 py-3 rounded-xl border border-slate-300 bg-slate-50 focus-within:border-emerald-600 focus-within:bg-white transition-all">
                <input
                  type="text"
                  placeholder="store-name"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
                  className="w-full bg-transparent outline-none font-mono text-sm text-slate-900"
                  required
                />
                <span className="text-slate-400 font-medium text-sm select-none pl-2 shrink-0">
                  .bcom.si
                </span>
              </div>
              <div className="mt-2 text-xs font-medium">
                {isCheckingSlug ? (
                  <span className="text-slate-500">Checking availability...</span>
                ) : slugStatus?.available ? (
                  <span className="text-emerald-700">✓ {slug}.bcom.si is available</span>
                ) : slugStatus ? (
                  <span className="text-rose-600">✕ {slugStatus.reason || "Subdomain is unavailable"}</span>
                ) : (
                  <span className="text-slate-400">At least 3 characters. Lowercase letters, numbers, and hyphens.</span>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={!slug || slug.length < 3 || !slugStatus?.available}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold rounded-xl shadow-md transition-all"
            >
              Continue to Account
            </button>
          </form>
        )}

        {/* Step 2: Account Details */}
        {step === 2 && (
          <form onSubmit={handleStep2Submit} className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Step 2: Store Owner Account</h2>
              <p className="text-sm text-slate-500">These credentials will be used to log into your merchant admin.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                  Your Full Name
                </label>
                <input
                  type="text"
                  placeholder="Aarav Sharma"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-emerald-600 outline-none text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                  Mobile Number (Optional)
                </label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-emerald-600 outline-none text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Business Email Address
              </label>
              <input
                type="email"
                placeholder="founder@yourstore.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-emerald-600 outline-none text-sm"
                required
              />
              <p className="mt-1 text-xs text-slate-400">Must be a valid business or personal email (no disposable addresses).</p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Password
              </label>
              <input
                type="password"
                placeholder="At least 10 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-emerald-600 outline-none text-sm"
                required
                minLength={10}
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="py-3.5 px-6 border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold rounded-xl text-sm transition-all"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all text-sm"
              >
                Continue to Business Details
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Business Details */}
        {step === 3 && (
          <form onSubmit={handleStep3Submit} className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Step 3: Tell us about your business</h2>
              <p className="text-sm text-slate-500">Helps us configure your default store settings and categories.</p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Industry Category
              </label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white focus:border-emerald-600 outline-none text-sm font-medium"
              >
                <option value="retail">General Retail & Lifestyle</option>
                <option value="fashion">Fashion & Apparel</option>
                <option value="food">Gourmet Food & Beverages</option>
                <option value="handicrafts">Handicrafts & Artisans</option>
                <option value="beauty">Beauty & Personal Care</option>
                <option value="electronics">Electronics & Accessories</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                City / State
              </label>
              <input
                type="text"
                placeholder="e.g. Mumbai, Maharashtra"
                value={businessCity}
                onChange={(e) => setBusinessCity(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-emerald-600 outline-none text-sm"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="py-3.5 px-6 border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold rounded-xl text-sm transition-all"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all text-sm"
              >
                Continue to Theme Selection
              </button>
            </div>
          </form>
        )}

        {/* Step 4: Pick Template */}
        {step === 4 && (
          <form onSubmit={handleStep4Submit} className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Step 4: Pick a starter theme</h2>
              <p className="text-sm text-slate-500">You can customize colors, fonts, and blocks anytime in Store Admin.</p>
            </div>

            <div className="space-y-4">
              {TEMPLATES.map((tmpl) => (
                <div
                  key={tmpl.code}
                  onClick={() => setSelectedTemplate(tmpl.code)}
                  className={`p-4 sm:p-5 rounded-2xl border cursor-pointer transition-all ${
                    selectedTemplate === tmpl.code
                      ? "border-emerald-600 bg-emerald-50/50 shadow-sm"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="font-bold text-slate-900 text-base">{tmpl.name}</h4>
                    <span className="text-xs uppercase font-bold tracking-wider text-slate-500">{tmpl.industry}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{tmpl.description}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="py-3.5 px-6 border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold rounded-xl text-sm transition-all"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all text-sm"
              >
                Continue to Plan
              </button>
            </div>
          </form>
        )}

        {/* Step 5: Plan Selection & Provisioning */}
        {step === 5 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Step 5: Review plan & launch</h2>
              <p className="text-sm text-slate-500">Every plan includes a 14-day free trial. Upgrade or cancel anytime.</p>
            </div>

            <div className="space-y-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.code}
                  onClick={() => setSelectedPlan(plan.code)}
                  className={`p-4 sm:p-5 rounded-2xl border cursor-pointer transition-all ${
                    selectedPlan === plan.code
                      ? "border-emerald-600 bg-emerald-50/40 shadow-sm"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-900 text-base">{plan.name}</h4>
                      {plan.popular && (
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          Recommended
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-slate-900 text-base">{plan.priceText}</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">{plan.description}</p>
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-600 font-medium">
                    {plan.features.map((f, i) => (
                      <span key={i} className="bg-white px-2 py-0.5 rounded border border-slate-200">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
              <div className="font-semibold text-slate-800">Launch Summary:</div>
              <div>• Store: <strong>{storeName}</strong> ({slug}.bcom.si)</div>
              <div>• Owner: <strong>{email}</strong></div>
              <div>• Trial: <strong>14 days free</strong> on {selectedPlan.toUpperCase()} tier</div>
            </div>

            {turnstileSiteKey && (
              <div className="flex justify-center">
                <TurnstileWidget key={turnstileNonce} siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                disabled={isProvisioning}
                onClick={() => setStep(4)}
                className="py-3.5 px-6 border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={isProvisioning || !configLoaded || (turnstileSiteKey !== null && !turnstileToken)}
                onClick={handleFinalSubmit}
                className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all text-sm disabled:bg-slate-400 flex items-center justify-center gap-2"
              >
                {isProvisioning ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>{provisionProgress}</span>
                  </>
                ) : (
                  <span>Launch My Store Now</span>
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
    <Suspense fallback={<div className="p-12 text-center text-slate-500 font-medium">Loading signup wizard...</div>}>
      <SignupContent />
    </Suspense>
  );
}
