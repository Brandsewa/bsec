"use client";

import { payWithRazorpay } from "@/lib/razorpay-client.ts";
import { priceOrder } from "@bs/domain/pricing";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StorefrontCart, StorefrontCheckoutConsent } from "@bs/domain";

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

/** One address from the signed-in shopper's address book. */
export interface SavedCheckoutAddress {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  stateCode: string;
  pincode: string;
  type: string;
  isDefault: boolean;
}

/** The address-book entry as the form's fields. The state is matched to the list; null when it is not one of them. */
function addressFields(a: SavedCheckoutAddress) {
  const state = INDIAN_STATES_AND_UTS.find((st) => st.toLowerCase() === a.stateCode.trim().toLowerCase()) ?? null;
  return {
    fullName: a.name,
    phone: a.phone.replace(/\D/g, "").slice(-10),
    addressLine1: [a.line1, a.line2, a.landmark].filter(Boolean).join(", "),
    city: a.city,
    state,
    pincode: a.pincode,
  };
}

export interface CheckoutFormProps {
  /** The signed-in shopper's saved addresses, default first; empty for a guest. */
  savedAddresses?: SavedCheckoutAddress[];
  /** The signed-in shopper's real email (not the placeholder made at sign-in). */
  customerEmail?: string;
  /** True when a customer is signed in: no Login link, no Create an account box. */
  signedIn?: boolean;

  cart: StorefrontCart;
  shippingRates: CheckoutShippingRate[];
  paymentOptions: CheckoutPaymentOptions;
  consent: StorefrontCheckoutConsent;
  paymentMethod?: "cod" | "online";
  onPaymentMethodChange?: (method: "cod" | "online") => void;
  shippingMethod?: string;
  onShippingMethodChange?: (method: string) => void;
  /** Called with the state the order ships to, on first render and whenever it changes, so shipping options can follow it. */
  onShippingStateChange?: (state: string) => void;
}

export function CheckoutForm({
  savedAddresses = [],
  customerEmail = "",
  signedIn = false,
  cart,
  shippingRates,
  paymentOptions,
  consent,
  paymentMethod: controlledPaymentMethod,
  onPaymentMethodChange,
  shippingMethod: controlledShippingMethod,
  onShippingMethodChange,
  onShippingStateChange,
}: CheckoutFormProps) {
  const router = useRouter();

  // A saved address (the default one, else the first that fits) is chosen up front when the shopper has any.
  const initialSaved = savedAddresses.find((a) => addressFields(a).state) ?? null;
  const initial = initialSaved ? addressFields(initialSaved) : null;
  const [selectedId, setSelectedId] = useState<string | null>(initialSaved?.id ?? null);
  const [addrMode, setAddrMode] = useState<"saved" | "form">(initialSaved ? "saved" : "form");
  const [chooseOpen, setChooseOpen] = useState(false);

  // Contact
  const [email, setEmail] = useState(customerEmail);
  const [phone, setPhone] = useState(initial?.phone ?? "");

  // A business buyer
  const [isBusiness, setIsBusiness] = useState(false);
  const [createAccount, setCreateAccount] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [taxId, setTaxId] = useState("");

  // Billing address (also the shipping address unless "Ship to a different address?" is ticked)
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [addressLine1, setAddressLine1] = useState(initial?.addressLine1 ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [state, setState] = useState(initial?.state ?? "Maharashtra");
  const [pincode, setPincode] = useState(initial?.pincode ?? "");

  const pickSaved = (a: SavedCheckoutAddress) => {
    const f = addressFields(a);
    setSelectedId(a.id);
    setFullName(f.fullName);
    setAddressLine1(f.addressLine1);
    setCity(f.city);
    if (f.state) setState(f.state);
    setPincode(f.pincode);
    if (f.phone && !phone) setPhone(f.phone);
    setAddrMode("saved");
    setChooseOpen(false);
  };
  const startNewAddress = () => {
    setSelectedId(null);
    setFullName("");
    setAddressLine1("");
    setCity("");
    setPincode("");
    setAddrMode("form");
  };

  // A separate shipping address, with its own contact
  const [shipDifferent, setShipDifferent] = useState(false);
  const [shipName, setShipName] = useState("");
  const [shipEmail, setShipEmail] = useState("");
  const [shipPhone, setShipPhone] = useState("");
  const [shipAddress1, setShipAddress1] = useState("");
  const [shipCity, setShipCity] = useState("");
  const [shipState, setShipState] = useState("Maharashtra");
  const [shipPincode, setShipPincode] = useState("");

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
  const [notesOpen, setNotesOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingAccepted, setMarketingAccepted] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The price comes from the store's own shipping rates (the same ones the order is charged with).
  const currentShippingPaise = (shippingRates.find((r) => r.method === shippingMethod) ?? shippingRates[0])?.amount ?? 0;

  // Shipping options follow the state the order ships to (the separate shipping address when one is used).
  const shippingState = shipDifferent ? shipState : state;
  useEffect(() => {
    if (shippingState) onShippingStateChange?.(shippingState);
  }, [shippingState, onShippingStateChange]);

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

    if (isBusiness) {
      if (!companyName.trim()) {
        setError("Please enter the company name for a business order");
        return;
      }
      if (taxId && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(taxId)) {
        setError("The Tax ID (GSTIN) should be 15 characters, like 22AAAAA0000A1Z5");
        return;
      }
    }

    const cleanShipPhone = shipPhone.replace(/\D/g, "");
    if (shipDifferent) {
      if (!shipName.trim() || !shipAddress1.trim() || !shipCity.trim() || !shipState.trim()) {
        setError("Please fill in all required shipping address fields");
        return;
      }
      if (!/^[1-9][0-9]{5}$/.test(shipPincode.trim())) {
        setError("Please enter a valid 6-digit pincode for the shipping address");
        return;
      }
      if (!/^[6-9][0-9]{9}$/.test(cleanShipPhone)) {
        setError("Please enter a valid 10-digit contact number for the shipping address");
        return;
      }
    }

    if (consent.termsRequired && !termsAccepted) {
      setError("Please tick the box to agree to the Terms and Conditions before placing your order");
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
          city: city.trim(),
          state: state.trim(),
          pincode: cleanPincode,
          shippingMethod,
          paymentMethod,
          notes: notes.trim() || undefined,
          createAccount: !signedIn && createAccount ? true : undefined,
          businessOrder: isBusiness ? { companyName: companyName.trim(), taxId: taxId || undefined } : undefined,
          shipTo: shipDifferent
            ? {
                fullName: shipName.trim(),
                email: shipEmail.trim() || undefined,
                phone: cleanShipPhone,
                addressLine1: shipAddress1.trim(),
                city: shipCity.trim(),
                state: shipState.trim(),
                pincode: shipPincode.trim(),
              }
            : undefined,
          termsConsent: consent.termsRequired ? termsAccepted : undefined,
          marketingConsent: consent.marketing ? marketingAccepted : undefined,
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
        // Online payment: the order exists and is unpaid; take the payment now. Closing the window or a failed payment
        // lands on the order page, which offers "Pay now" again.
        if (data.razorpay && data.orderToken) {
          const outcome = await payWithRazorpay(data.razorpay, data.orderToken);
          if (outcome.status === "failed") {
            router.push(`${data.redirectUrl}?payment=failed`);
            return;
          }
        }
        router.push(data.redirectUrl);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error placing order");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
      {/* 1. Contact, with an optional business block */}
      <section className={CARD}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">Contact Information</h2>
          {!signedIn ? (
            <a href="/account/login" className="text-sm font-semibold text-foreground hover:underline">
              Login
            </a>
          ) : null}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <TextField id="checkout-fullname" label="Full name *" required value={fullName} onChange={setFullName} />
          </div>
          <TextField id="checkout-email" label="Email address *" type="email" required value={email} onChange={setEmail} />
          <PhoneField id="checkout-phone" label="Phone number *" value={phone} onChange={setPhone} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={isBusiness} onChange={(e) => setIsBusiness(e.target.checked)} className="h-3.5 w-3.5 rounded border-border/70" />
            Business Order
          </label>
          {!signedIn ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={createAccount} onChange={(e) => setCreateAccount(e.target.checked)} className="h-3.5 w-3.5 rounded border-border/70" />
              Create an account
            </label>
          ) : null}
        </div>
        {isBusiness ? (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="business-fields">
            <TextField id="checkout-company" label="Company name *" required value={companyName} onChange={setCompanyName} maxLength={120} />
            <TextField id="checkout-taxid" label="Tax ID (GSTIN), optional" value={taxId} onChange={(v) => setTaxId(v.toUpperCase().replace(/[^0-9A-Z]/g, ""))} maxLength={15} />
          </div>
        ) : null}
      </section>

      {/* 2. Billing and shipping address; one form, or two when the order ships elsewhere */}
      <section className={CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">{shipDifferent ? "Billing Address" : "Billing & Shipping Address"}</h2>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={shipDifferent} onChange={(e) => setShipDifferent(e.target.checked)} className="h-3.5 w-3.5 rounded border-border/70" />
            Ship to a different address?
          </label>
        </div>
        {savedAddresses.length > 0 && addrMode === "saved" ? (
          <div className="space-y-2" data-testid="saved-addresses">
            {savedAddresses.filter((a) => a.id === selectedId).map((a) => (
              <SavedAddressCard key={a.id} a={a} chosen onPick={pickSaved} onEdit={() => setAddrMode("form")} />
            ))}
            <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm">
              {savedAddresses.length > 1 ? (
                <button type="button" onClick={() => setChooseOpen(true)} className="font-semibold text-foreground hover:underline">
                  Choose another address
                </button>
              ) : null}
              <button type="button" onClick={startNewAddress} className="font-semibold text-foreground hover:underline">
                Add a new address
              </button>
              <a href="/account/addresses" className="font-semibold text-foreground hover:underline">
                Manage addresses
              </a>
            </div>
            {chooseOpen ? (
              <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
                <div className="absolute inset-0 bg-black/50" onClick={() => setChooseOpen(false)} aria-hidden />
                <div role="dialog" aria-modal="true" aria-label="Choose an address" className="bs-skin relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl bg-background p-4 text-foreground shadow-xl sm:rounded-2xl">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-base font-semibold">Choose an address</h3>
                    <button type="button" onClick={() => setChooseOpen(false)} aria-label="Close" className="rounded-full px-2 py-1 text-lg leading-none hover:bg-muted">
                      ×
                    </button>
                  </div>
                  <div className="space-y-2 overflow-y-auto">
                    {savedAddresses.map((a) => (
                      <SavedAddressCard key={a.id} a={a} chosen={a.id === selectedId} onPick={pickSaved} />
                    ))}
                  </div>
                  <div className="mt-3 flex justify-end gap-4 text-sm">
                    <button type="button" onClick={() => { setChooseOpen(false); startNewAddress(); }} className="font-semibold hover:underline">
                      Add a new address
                    </button>
                    <a href="/account/addresses" className="font-semibold hover:underline">
                      Manage addresses
                    </a>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {savedAddresses.length > 0 ? (
              <button type="button" onClick={() => { const a = savedAddresses.find((x) => x.id === selectedId) ?? savedAddresses.find((x) => addressFields(x).state); if (a) pickSaved(a); }} className="mb-2.5 text-sm font-semibold text-foreground hover:underline">
                Use a saved address
              </button>
            ) : null}
        <AddressFields
          idPrefix="checkout"
          showName={false}
          values={{ fullName, addressLine1, city, state, pincode }}
          onChange={(k, v) => {
            if (k === "fullName") setFullName(v);
            else if (k === "addressLine1") setAddressLine1(v);
            else if (k === "city") setCity(v);
            else if (k === "state") setState(v);
            else setPincode(v);
          }}
        />
          </>
        )}
      </section>

      {shipDifferent ? (
        <section data-testid="shipping-address-fields" className={CARD}>
          <h2 className="mb-2.5 text-base font-semibold tracking-tight text-foreground sm:text-lg">Shipping Address</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <TextField id="checkout-ship-name" label="Full name *" required value={shipName} onChange={setShipName} />
              </div>
              <TextField id="checkout-ship-email" label="Contact email (optional)" type="email" value={shipEmail} onChange={setShipEmail} />
              <PhoneField id="checkout-ship-phone" label="Contact phone *" value={shipPhone} onChange={setShipPhone} required />
            </div>
            <AddressFields
              idPrefix="checkout-ship"
              showName={false}
              values={{ fullName: shipName, addressLine1: shipAddress1, city: shipCity, state: shipState, pincode: shipPincode }}
              onChange={(k, v) => {
                if (k === "fullName") setShipName(v);
                else if (k === "addressLine1") setShipAddress1(v);
                else if (k === "city") setShipCity(v);
                else if (k === "state") setShipState(v);
                else setShipPincode(v);
              }}
            />
          </div>
        </section>
      ) : null}

      {/* 3. Shipping Method: the store's own options and prices */}
      <section className={CARD}>
        <h2 className="mb-3 text-base font-semibold tracking-tight text-foreground sm:text-lg">Shipping Method</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {shippingRates.map((rate) => (
            <label
              key={rate.method}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-muted/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
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
      <section className={CARD}>
        <h2 className="mb-3 text-base font-semibold tracking-tight text-foreground sm:text-lg">Payment Method</h2>
        <div className="space-y-2">
          {paymentOptions.codEnabled && (
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-muted/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
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
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-muted/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
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

      {/* 5. Order instructions, tucked away until asked for */}
      <section>
        <button
          type="button"
          onClick={() => setNotesOpen((o) => !o)}
          aria-expanded={notesOpen}
          aria-controls="checkout-notes-panel"
          className="flex w-full items-center justify-between bs-panel px-3.5 py-2.5 text-left text-sm font-medium text-foreground transition-opacity hover:opacity-90"
        >
          <span>Order Instructions / Delivery Notes (Optional)</span>
          <svg aria-hidden className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${notesOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <div id="checkout-notes-panel" className={notesOpen ? "mt-2" : "hidden"}>
          <label htmlFor="checkout-notes" className="sr-only">
            Order instructions and delivery notes
          </label>
          <textarea
            id="checkout-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Special notes for delivery agent, gate code, landmarks, etc."
            className={INPUT_CLASS}
          />
        </div>
      </section>

      {/* 6. Consent: one terms box that also covers order emails, plus the optional marketing box */}
      <section className="space-y-3">
        {consent.termsRequired ? (
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              required
              className="mt-0.5 h-4 w-4 rounded border-border/70"
            />
            <span>
              I agree to the{" "}
              <a href="/policies/terms" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                Terms and Conditions
              </a>{" "}
              and allow this store to email me about my order: confirmation, shipping and delivery updates, and a reminder if I leave items in my cart.
            </span>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            We will email you about your order: confirmation, shipping and delivery updates, and a reminder if you leave items in your cart.
          </p>
        )}
        {consent.marketing && (
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={marketingAccepted}
              onChange={(e) => setMarketingAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border/70"
            />
            <span>{consent.marketing.label}</span>
          </label>
        )}
      </section>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive font-medium">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || noPaymentMethod}
        className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading ? "Processing Order..." : `Place Order (₹${(
          priceOrder({
            subtotal: cart.subtotal,
            shipping: currentShippingPaise,
            codFee: codFeePaise,
            discount: cart.discount ? { type: cart.discount.type, discountAmount: cart.discount.amount } : null,
          }).grandTotal / 100
        ).toLocaleString("en-IN")})`}
      </button>
    </form>
  );
}

// Each step of the checkout is a grey panel (the same one as the order summary), with white fields that stand out on it.
const CARD = "bs-panel p-4 sm:p-6";


const INPUT_CLASS =
  "bs-field w-full rounded-lg border px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground/70 hover:border-border focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15";

// A field whose name sits inside it: the name reads as the placeholder, then shrinks to the top edge once there is text or focus.
const FIELD_CLASS =
  "bs-field peer h-12 w-full rounded-lg border px-3 pb-1 pt-5 text-sm text-foreground placeholder-transparent transition-colors hover:border-border focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15";
const FLOAT_LABEL =
  "pointer-events-none absolute left-3 top-3 origin-left text-sm text-muted-foreground transition-all peer-focus:top-1.5 peer-focus:text-[11px] peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:text-[11px]";
// Same, for fields that always show a value (the state list, the phone number with its +91): the name stays small at the top.
const LABEL_TOP = "pointer-events-none absolute left-3 top-1.5 text-[11px] text-muted-foreground";

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <div className="relative">
      <input id={id} type={type} required={required} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} placeholder=" " className={FIELD_CLASS} />
      <label htmlFor={id} className={FLOAT_LABEL}>
        {label}
      </label>
    </div>
  );
}

function PhoneField({ id, label, value, onChange, required = true }: { id: string; label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute bottom-[0.55rem] left-3 text-sm font-medium text-muted-foreground">+91</span>
      <input id={id} type="tel" required={required} maxLength={10} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} placeholder=" " className={`${FIELD_CLASS} pl-11`} />
      <label htmlFor={id} className={LABEL_TOP}>
        {label}
      </label>
    </div>
  );
}

type AddressKey = "fullName" | "addressLine1" | "city" | "state" | "pincode";

/** Name, street, city, state and pincode: used once for the billing and shipping address, and again for a separate shipping address. */
function AddressFields({ idPrefix, values, onChange, showName = true }: { idPrefix: string; values: Record<AddressKey, string>; onChange: (key: AddressKey, value: string) => void; showName?: boolean }) {
  return (
    <div className="space-y-3">
      {showName ? <TextField id={`${idPrefix}-fullname`} label="Full name *" required value={values.fullName} onChange={(v) => onChange("fullName", v)} /> : null}
      <TextField id={`${idPrefix}-address1`} label="Address (flat, building, street) *" required value={values.addressLine1} onChange={(v) => onChange("addressLine1", v)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField id={`${idPrefix}-city`} label="City *" required value={values.city} onChange={(v) => onChange("city", v)} />
        <div className="relative">
          <select id={`${idPrefix}-state`} value={values.state} onChange={(e) => onChange("state", e.target.value)} className={`${FIELD_CLASS} appearance-none pr-8`}>
            {INDIAN_STATES_AND_UTS.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <label htmlFor={`${idPrefix}-state`} className={LABEL_TOP}>
            State *
          </label>
          <svg aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </div>
        <TextField id={`${idPrefix}-pincode`} label="Pincode *" required maxLength={6} value={values.pincode} onChange={(v) => onChange("pincode", v.replace(/\D/g, ""))} />
      </div>
    </div>
  );
}

function SavedAddressCard({ a, chosen, onPick, onEdit }: { a: SavedCheckoutAddress; chosen: boolean; onPick: (a: SavedCheckoutAddress) => void; onEdit?: () => void }) {
  const usable = addressFields(a).state !== null;
  return (
    <div className={`flex items-start gap-3 rounded-xl p-3.5 text-sm ${chosen ? "bg-muted ring-1 ring-primary/40" : "bg-muted/50"}`}>
      <input type="radio" name="saved-address" checked={chosen} disabled={!usable} onChange={() => onPick(a)} aria-label={`Deliver to ${a.name}, ${a.line1}`} className="mt-1 h-4 w-4" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          {a.name} <span className="ml-1 rounded-full bg-background px-2 py-0.5 text-[11px] font-normal capitalize text-muted-foreground">{a.type}</span>
          {a.isDefault ? <span className="ml-1 text-[11px] font-normal text-muted-foreground">Default</span> : null}
        </p>
        <p className="text-muted-foreground">
          {[a.line1, a.line2, a.landmark].filter(Boolean).join(", ")}, {a.city}, {a.stateCode} {a.pincode}
        </p>
        <p className="text-muted-foreground">+91 {a.phone.replace(/\D/g, "").slice(-10)}</p>
        {!usable ? <p className="text-xs text-destructive">Choose the state again to use this address.</p> : null}
      </div>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="shrink-0 text-xs font-semibold text-foreground hover:underline">
          Edit
        </button>
      ) : null}
    </div>
  );
}
