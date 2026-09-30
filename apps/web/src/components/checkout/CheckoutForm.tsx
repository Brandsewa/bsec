"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { StorefrontCart } from "@bs/domain";

export const INDIAN_STATES_AND_UTS = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

export interface CheckoutShippingRate {
  method: string;
  title: string;
  description: string;
  estimatedDays: string;
  /** In paise; 0 means free. */
  amount: number;
}

export interface CheckoutPaymentOptions {
  codEnabled: boolean;
  /** Cash-on-delivery handling fee in paise (0 = none). */
  codFeePaise: number;
  /** False until real online payments exist: the option is then not shown. */
  onlineAvailable: boolean;
}

export interface CheckoutFormProps {
  cart: StorefrontCart;
  shippingRates: CheckoutShippingRate[];
  paymentOptions: CheckoutPaymentOptions;
  paymentMethod?: "cod" | "online";
  onPaymentMethodChange?: (method: "cod" | "online") => void;
  shippingMethod?: string;
  onShippingMethodChange?: (method: string) => void;
}

export function CheckoutForm({
  cart,
  shippingRates,
  paymentOptions,
  paymentMethod: controlledPaymentMethod,
  onPaymentMethodChange,
  shippingMethod: controlledShippingMethod,
  onShippingMethodChange,
}: CheckoutFormProps) {
  const router = useRouter();

  // Contact
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Address
  const [fullName, setFullName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Maharashtra");
  const [pincode, setPincode] = useState("");

  // Method
  const [internalShippingMethod, setInternalShippingMethod] = useState<string>(shippingRates[0]?.method ?? "");
  const shippingMethod = controlledShippingMethod ?? internalShippingMethod;
  const [internalPaymentMethod, setInternalPaymentMethod] = useState<"cod" | "online">(paymentOptions.codEnabled ? "cod" : "online");
  const paymentMethod = controlledPaymentMethod ?? internalPaymentMethod;
  const setPaymentMethod = (method: "cod" | "online") => {
    if (controlledPaymentMethod === undefined) setInternalPaymentMethod(method);
    onPaymentMethodChange?.(method);
  };
  const noPaymentMethod = !paymentOptions.codEnabled && !paymentOptions.onlineAvailable;
  const codFeePaise = paymentMethod === "cod" && paymentOptions.codEnabled ? paymentOptions.codFeePaise : 0;
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The price comes from the store's own shipping rates (the same ones the order is charged with).
  const currentShippingPaise = (shippingRates.find((r) => r.method === shippingMethod) ?? shippingRates[0])?.amount ?? 0;

  const handleShippingChange = (method: string) => {
    if (controlledShippingMethod === undefined) {
      setInternalShippingMethod(method);
    }
    if (onShippingMethodChange) {
      onShippingMethodChange(method);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate phone: 10 digits starting with 6-9
    const cleanPhone = phone.replace(/\D/g, "");
    if (!/^[6-9][0-9]{9}$/.test(cleanPhone)) {
      setError("Please enter a valid 10-digit Indian mobile number");
      return;
    }

    // Validate pincode: 6 digits
    const cleanPincode = pincode.trim();
    if (!/^[1-9][0-9]{5}$/.test(cleanPincode)) {
      setError("Please enter a valid 6-digit Indian Pincode");
      return;
    }

    if (!fullName.trim() || !addressLine1.trim() || !city.trim() || !state.trim()) {
      setError("Please fill in all required shipping address fields");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/storefront/checkout/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          phone: cleanPhone,
          fullName: fullName.trim(),
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim() || undefined,
          city: city.trim(),
          state: state.trim(),
          pincode: cleanPincode,
          shippingMethod,
          paymentMethod,
          notes: notes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to place order");
      }

      const data = await res.json();
      if (data.redirectUrl) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("cart-updated"));
        }
        router.push(data.redirectUrl);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error placing order");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* 1. Customer Information */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground mb-4">Contact Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="checkout-email" className="block text-xs font-semibold text-foreground mb-1">
              Email Address *
            </label>
            <input
              id="checkout-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="checkout-phone" className="block text-xs font-semibold text-foreground mb-1">
              Phone Number (+91) *
            </label>
            <div className="flex">
              <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-border bg-muted text-xs font-medium text-muted-foreground">
                +91
              </span>
              <input
                id="checkout-phone"
                type="tel"
                required
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                placeholder="9876543210"
                className="w-full rounded-r-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. Shipping Address */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground mb-4">Shipping Address</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="checkout-fullname" className="block text-xs font-semibold text-foreground mb-1">
              Full Name *
            </label>
            <input
              id="checkout-fullname"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Aarav Sharma"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="checkout-address1" className="block text-xs font-semibold text-foreground mb-1">
              Address Line 1 *
            </label>
            <input
              id="checkout-address1"
              type="text"
              required
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="Flat / House No., Building Name, Street"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label htmlFor="checkout-address2" className="block text-xs font-semibold text-foreground mb-1">
              Address Line 2 (Optional)
            </label>
            <input
              id="checkout-address2"
              type="text"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Landmark, Area, Colony"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="checkout-city" className="block text-xs font-semibold text-foreground mb-1">
                City *
              </label>
              <input
                id="checkout-city"
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Mumbai"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label htmlFor="checkout-state" className="block text-xs font-semibold text-foreground mb-1">
                State *
              </label>
              <select
                id="checkout-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {INDIAN_STATES_AND_UTS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="checkout-pincode" className="block text-xs font-semibold text-foreground mb-1">
                Pincode *
              </label>
              <input
                id="checkout-pincode"
                type="text"
                required
                maxLength={6}
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
                placeholder="400001"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 3. Shipping Method: the store's own options and prices */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground mb-4">Shipping Method</h2>
        <div className="space-y-3">
          {shippingRates.map((rate) => (
            <label
              key={rate.method}
              className="flex items-center justify-between p-3.5 border rounded-xl cursor-pointer hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="shippingMethod"
                  value={rate.method}
                  checked={shippingMethod === rate.method}
                  onChange={() => handleShippingChange(rate.method)}
                  className="text-primary focus:ring-primary"
                />
                <div>
                  <p className="text-sm font-semibold text-foreground">{rate.title}</p>
                  <p className="text-xs text-muted-foreground">{rate.description}</p>
                </div>
              </div>
              <span className="text-sm font-bold text-foreground">
                {rate.amount === 0 ? "Free" : `₹${(rate.amount / 100).toLocaleString("en-IN")}`}
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* 4. Payment Method: only what this store can really take */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground mb-4">Payment Method</h2>
        <div className="space-y-3">
          {paymentOptions.codEnabled && (
            <label className="flex items-center justify-between p-3.5 border rounded-xl cursor-pointer hover:bg-muted/40 transition-colors">
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cod"
                  checked={paymentMethod === "cod"}
                  onChange={() => setPaymentMethod("cod")}
                  className="text-primary focus:ring-primary"
                />
                <div>
                  <p className="text-sm font-semibold text-foreground">Cash on Delivery (COD)</p>
                  <p className="text-xs text-muted-foreground">
                    Pay with cash or UPI upon delivery
                    {paymentOptions.codFeePaise > 0 ? ` (₹${(paymentOptions.codFeePaise / 100).toLocaleString("en-IN")} handling fee)` : ""}
                  </p>
                </div>
              </div>
            </label>
          )}

          {paymentOptions.onlineAvailable && (
            <label className="flex items-center justify-between p-3.5 border rounded-xl cursor-pointer hover:bg-muted/40 transition-colors">
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="online"
                  checked={paymentMethod === "online"}
                  onChange={() => setPaymentMethod("online")}
                  className="text-primary focus:ring-primary"
                />
                <div>
                  <p className="text-sm font-semibold text-foreground">UPI / Card / NetBanking</p>
                  <p className="text-xs text-muted-foreground">Pay securely online</p>
                </div>
              </div>
            </label>
          )}

          {noPaymentMethod && (
            <p className="text-sm text-muted-foreground" role="alert">
              This store is not taking orders online right now. Please contact the store to place your order.
            </p>
          )}
        </div>
      </section>

      {/* 5. Special Notes */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <label htmlFor="checkout-notes" className="block text-sm font-bold text-foreground mb-2">
          Order Instructions / Delivery Notes (Optional)
        </label>
        <textarea
          id="checkout-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Special notes for delivery agent, gate code, landmarks, etc."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </section>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive font-medium">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || noPaymentMethod}
        className="w-full rounded-xl bg-primary py-4 px-6 text-base font-bold text-primary-foreground shadow hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading ? "Processing Order..." : `Place Order (₹${((cart.subtotal + currentShippingPaise + codFeePaise) / 100).toLocaleString("en-IN")})`}
      </button>
    </form>
  );
}
