"use client";

import React, { useState } from "react";
import Link from "next/link";
import { SubdomainAvailabilityChecker } from "./SubdomainAvailabilityChecker.tsx";

interface PlanItem {
  code: string;
  name: string;
  monthlyPaise: number;
  yearlyPaise: number;
  description: string;
  features: string[];
  popular?: boolean;
}

const DEFAULT_PLANS: PlanItem[] = [
  {
    code: "starter",
    name: "Starter",
    monthlyPaise: 99900,
    yearlyPaise: 999000,
    description: "Perfect for new direct-to-consumer creators and boutique stores starting online.",
    features: [
      "Up to 500 products",
      "2 staff accounts",
      "5 GB fast media storage",
      "₹99 Standard India flat rate shipping",
      "Cash on Delivery & Razorpay integration",
      "Automated GST Tax Invoices",
      "1 Custom Domain connection",
    ],
  },
  {
    code: "growth",
    name: "Growth",
    monthlyPaise: 249900,
    yearlyPaise: 2499000,
    description: "For scaling Indian brands needing multi-staff workflows and high order throughput.",
    features: [
      "Up to 5,000 products",
      "5 staff accounts",
      "25 GB fast media storage",
      "3 Custom Domains included",
      "Shiprocket automated label printing & tracking",
      "Remove 'Powered by bcom.si' branding",
      "Advanced discount engine (BXGY, fixed, %)",
      "Priority webhook dispatch",
    ],
    popular: true,
  },
  {
    code: "pro",
    name: "Pro",
    monthlyPaise: 599900,
    yearlyPaise: 5999000,
    description: "Uncapped scale, enterprise concurrency, and dedicated infrastructure support.",
    features: [
      "Up to 25,000 products",
      "15 staff accounts",
      "100 GB fast media storage",
      "10 Custom Domains included",
      "High-concurrency flash sale protection",
      "Multi-location inventory tracking",
      "Full store CSV / JSON data export",
      "Dedicated 24/7 priority SLA support",
    ],
  },
];

const TEMPLATES = [
  {
    code: "starter-minimal",
    name: "Minimalist Essential",
    industry: "Handicrafts & General Retail",
    tagline: "Clean, distraction-free typography highlighting artisan craft details.",
    color: "from-stone-800 to-amber-900",
  },
  {
    code: "fashion-editorial",
    name: "Fashion Editorial",
    industry: "Apparel & Accessories",
    tagline: "High-impact visual lookbook with rich full-width editorial hero blocks.",
    color: "from-slate-900 to-indigo-950",
  },
  {
    code: "gourmet-artisan",
    name: "Gourmet Artisan",
    industry: "Food, Tea & Organic Goods",
    tagline: "Warm organic palette with custom freshness badges and dietary filters.",
    color: "from-emerald-950 to-teal-900",
  },
];

const FAQS = [
  {
    q: "Can I connect my own custom domain like mystore.in?",
    a: "Yes! Every store gets a free permanent {slug}.bcom.si address instantly. You can connect your custom domain (.in, .com, .store, etc.) at any time with automatic free Cloudflare SSL certificates.",
  },
  {
    q: "Do you take any transaction commission on my sales?",
    a: "Zero transaction fees! Unlike other platforms that charge 1-2% on every sale, we only charge the fixed SaaS plan fee. 100% of your earnings go straight to your bank account via your own payment gateway.",
  },
  {
    q: "What payment methods are supported for Indian customers?",
    a: "Direct-to-consumer stores on bcom.si support Cash on Delivery (COD) out of the box with custom fee controls, alongside Instant UPI, RuPay, Credit/Debit cards, and Netbanking through Razorpay.",
  },
  {
    q: "How does shipping and order tracking work?",
    a: "You get native India flat-rate shipping zones pre-configured. You can also connect your own Shiprocket account with one click to generate shipping labels, manifest orders, and track pickups in real time.",
  },
  {
    q: "Is there a free trial period?",
    a: "Yes, every new store comes with a full 14-day free trial on your chosen plan. No credit card required to start building and testing your storefront.",
  },
];

export function MarketingLandingPage() {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const formatPrice = (paise: number) => {
    return `₹${(paise / 100).toLocaleString("en-IN")}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-100 selection:text-emerald-900">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-extrabold text-xl shadow-sm">
              g
            </span>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              bcom<span className="text-emerald-600">.si</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#templates" className="hover:text-slate-900 transition-colors">Templates</a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">How it works</a>
            <a href="#pricing" className="hover:text-slate-900 transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-slate-900 transition-colors">FAQ</a>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="https://admin.bcom.si"
              className="text-sm font-semibold text-slate-700 hover:text-slate-900 px-3.5 py-2 rounded-lg hover:bg-slate-100 transition-all"
            >
              Log in
            </a>
            <Link
              href="/signup"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl shadow-sm hover:shadow transition-all"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      {/* 1. Hero Section (PLAN §7) */}
      <section className="relative pt-16 pb-20 sm:pt-24 sm:pb-28 overflow-hidden bg-gradient-to-b from-white to-slate-50 border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold mb-6">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            Fastest Commerce Platform for Modern Indian Brands
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 leading-tight sm:leading-none mb-6">
            Launch your online store <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              in under 10 minutes.
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-lg sm:text-xl text-slate-600 font-normal mb-10 leading-relaxed">
            Everything an Indian D2C merchant needs: instant UPI & COD, Shiprocket automation, GST-compliant tax invoices, and blazing fast storefronts.
          </p>

          {/* Subdomain check input (Step 1 of signup) */}
          <SubdomainAvailabilityChecker platformDomain="bcom.si" />

          <p className="mt-4 text-xs text-slate-500 font-medium">
            14-day free trial · No credit card required · Instant setup
          </p>
        </div>
      </section>

      {/* 2. Proof Strip (PLAN §7) */}
      <section className="py-12 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs font-bold uppercase tracking-wider text-slate-400 mb-8">
            Powering high-growth direct-to-consumer creators across India
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 items-center justify-center text-center opacity-70">
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold text-slate-800 tracking-tight">Kolkata Handlooms</span>
              <span className="text-xs text-slate-500">artisan fabrics · live</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold text-slate-800 tracking-tight">Organic Valley Co</span>
              <span className="text-xs text-slate-500">spices & honey · live</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold text-slate-800 tracking-tight">Studio Nirvana</span>
              <span className="text-xs text-slate-500">designer apparel · live</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold text-slate-800 tracking-tight">Pure Terra Crafts</span>
              <span className="text-xs text-slate-500">sustainable living · live</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Features Grid (PLAN §7) */}
      <section id="features" className="py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-3">
              Engineered for India
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Built natively for direct-to-consumer scale
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xl mb-5">
                ₹
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">UPI & Cash on Delivery</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Native COD with customizable verification and automated fee adjustments alongside PhonePe, Google Pay, and Paytm checkout.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xl mb-5">
                🚚
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Shiprocket Automation</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Single-click shipping label generation, automated AWB assignment, and real-time tracking across 29,000+ Indian pincodes.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xl mb-5">
                📄
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">GST Tax Invoices</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Automated legal GST tax invoices with state-wise IGST/CGST/SGST split, HSN code breakdowns, and instant PDF download.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xl mb-5">
                🌐
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Custom Domains & SSL</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Connect your brand's domain in seconds with enterprise Cloudflare for SaaS edge acceleration and automatic zero-downtime SSL.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-xl mb-5">
                📱
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Mobile-First Block Themes</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Lightning-fast responsive layouts optimized for 95%+ mobile shopping traffic with zero merchant code overhead.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-8 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xl mb-5">
                💬
              </div>
              <span className="absolute top-6 right-6 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                Coming Soon
              </span>
              <h3 className="text-xl font-bold text-slate-900 mb-2">WhatsApp Notifications</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Automated WhatsApp order confirmations, dispatch alerts, and abandoned cart recovery directly to Indian customer numbers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Templates Gallery (PLAN §7) */}
      <section id="templates" className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-3">
              Starter Themes
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Professionally designed for your niche
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {TEMPLATES.map((tmpl) => (
              <div key={tmpl.code} className="flex flex-col rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-lg transition-all">
                <div className={`h-48 bg-gradient-to-br ${tmpl.color} p-6 flex flex-col justify-end text-white`}>
                  <span className="text-xs uppercase font-bold tracking-wider opacity-80">{tmpl.industry}</span>
                  <h4 className="text-2xl font-extrabold tracking-tight mt-1">{tmpl.name}</h4>
                </div>
                <div className="p-6 flex-1 flex flex-col justify-between bg-white">
                  <p className="text-sm text-slate-600 mb-6">{tmpl.tagline}</p>
                  <Link
                    href={`/signup?template=${tmpl.code}`}
                    className="w-full py-2.5 px-4 text-center rounded-xl bg-slate-100 hover:bg-emerald-600 hover:text-white text-slate-800 font-semibold text-sm transition-all"
                  >
                    Start with this template
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. How It Works (PLAN §7) */}
      <section id="how-it-works" className="py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-3">
              5 Simple Steps
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              From zero to your first order
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 text-center">
            <div className="p-6 bg-white rounded-2xl border border-slate-200">
              <span className="inline-block w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold text-sm leading-8 mb-4">1</span>
              <h4 className="font-bold text-base mb-1">Pick Subdomain</h4>
              <p className="text-xs text-slate-500">Claim your instant brand address on bcom.si</p>
            </div>
            <div className="p-6 bg-white rounded-2xl border border-slate-200">
              <span className="inline-block w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold text-sm leading-8 mb-4">2</span>
              <h4 className="font-bold text-base mb-1">Choose Template</h4>
              <p className="text-xs text-slate-500">Pick a mobile-first theme matching your industry</p>
            </div>
            <div className="p-6 bg-white rounded-2xl border border-slate-200">
              <span className="inline-block w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold text-sm leading-8 mb-4">3</span>
              <h4 className="font-bold text-base mb-1">Add Products</h4>
              <p className="text-xs text-slate-500">Upload photos, set prices, and configure variants</p>
            </div>
            <div className="p-6 bg-white rounded-2xl border border-slate-200">
              <span className="inline-block w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold text-sm leading-8 mb-4">4</span>
              <h4 className="font-bold text-base mb-1">Connect Payments</h4>
              <p className="text-xs text-slate-500">Enable Cash on Delivery and link Razorpay UPI</p>
            </div>
            <div className="p-6 bg-white rounded-2xl border border-slate-200">
              <span className="inline-block w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold text-sm leading-8 mb-4">5</span>
              <h4 className="font-bold text-base mb-1">Start Selling</h4>
              <p className="text-xs text-slate-500">Connect your custom domain and share your link</p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Pricing Section (PLAN §7) */}
      <section id="pricing" className="py-20 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-3">
              Simple, Transparent Pricing
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mb-6">
              Predictable plans with zero hidden fees
            </p>

            {/* Toggle Monthly vs Yearly */}
            <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setBillingInterval("monthly")}
                className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
                  billingInterval === "monthly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingInterval("yearly")}
                className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                  billingInterval === "yearly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Yearly
                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  2 Months Free
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch max-w-6xl mx-auto">
            {DEFAULT_PLANS.map((plan) => {
              const pricePaise = billingInterval === "monthly" ? plan.monthlyPaise : plan.yearlyPaise / 12;
              return (
                <div
                  key={plan.code}
                  className={`flex flex-col p-8 rounded-3xl border transition-all ${
                    plan.popular
                      ? "border-emerald-600 bg-white shadow-xl relative scale-105 z-10"
                      : "border-slate-200 bg-white shadow-sm hover:shadow-md"
                  }`}
                >
                  {plan.popular && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider shadow">
                      Most Popular
                    </span>
                  )}
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">{plan.name}</h3>
                    <p className="text-sm text-slate-600 min-h-[40px]">{plan.description}</p>
                  </div>

                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold text-slate-900">{formatPrice(pricePaise)}</span>
                      <span className="text-sm text-slate-500 font-medium">/ month</span>
                    </div>
                    {billingInterval === "yearly" && (
                      <p className="text-xs text-emerald-700 font-semibold mt-1">
                        Billed annually ({formatPrice(plan.yearlyPaise)}/yr)
                      </p>
                    )}
                  </div>

                  <ul className="space-y-3.5 mb-8 flex-1 text-sm text-slate-600">
                    {plan.features.map((feat, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <svg className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={`/signup?plan=${plan.code}&interval=${billingInterval}`}
                    className={`w-full py-3 px-6 rounded-xl font-bold text-center text-sm shadow-sm transition-all ${
                      plan.popular
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-900"
                    }`}
                  >
                    Start 14-Day Free Trial
                  </Link>
                </div>
              );
            })}
          </div>

          <p className="mt-8 text-center text-xs text-slate-500">
            * All prices in INR. 18% GST applicable at checkout. Zero transaction commission on your store sales.
          </p>
        </div>
      </section>

      {/* 7. FAQ Section (PLAN §7) */}
      <section id="faq" className="py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-3">FAQ</h2>
            <p className="text-3xl font-extrabold text-slate-900 tracking-tight">Frequently asked questions</p>
          </div>

          <div className="space-y-4">
            {FAQS.map((faq, index) => {
              const isOpen = activeFaq === index;
              return (
                <div key={index} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setActiveFaq(isOpen ? null : index)}
                    className="w-full px-6 py-5 text-left font-bold text-base text-slate-900 flex items-center justify-between gap-4"
                  >
                    <span>{faq.q}</span>
                    <span className="text-slate-400 font-mono text-xl">{isOpen ? "−" : "+"}</span>
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-4">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer (PLAN §7) */}
      <footer className="bg-slate-900 text-slate-400 py-16 text-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-slate-950 font-black text-lg">
                  g
                </span>
                <span className="text-lg font-bold text-white tracking-tight">bcom.si</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">
                The high-performance ecommerce platform designed for modern Indian D2C creators.
              </p>
            </div>

            <div>
              <h5 className="font-bold text-white mb-4 text-xs uppercase tracking-wider">Product</h5>
              <ul className="space-y-2.5 text-xs">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#templates" className="hover:text-white transition-colors">Templates</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
              </ul>
            </div>

            <div>
              <h5 className="font-bold text-white mb-4 text-xs uppercase tracking-wider">Legal & Compliance</h5>
              <ul className="space-y-2.5 text-xs">
                <li><Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
                <li><Link href="/privacy" className="hover:text-white transition-colors">DPA & Subprocessors</Link></li>
              </ul>
            </div>

            <div>
              <h5 className="font-bold text-white mb-4 text-xs uppercase tracking-wider">Account</h5>
              <ul className="space-y-2.5 text-xs">
                <li><a href="https://admin.bcom.si" className="hover:text-white transition-colors">Merchant Admin Login</a></li>
                <li><Link href="/signup" className="hover:text-white transition-colors">Create Free Trial Store</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-slate-800 text-xs flex flex-col sm:flex-row items-center justify-between gap-4">
            <p>© {new Date().getFullYear()} bcom.si. All rights reserved.</p>
            <p>Built with enterprise multi-tenant isolation on AWS Mumbai (ap-south-1).</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
