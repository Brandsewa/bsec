"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import type { ContactFormOptions } from "@bs/blocks";

// The same fields as the checkout (CheckoutForm.tsx): near-white with a soft border, the name inside the field that shrinks to the top edge
// once there is text or focus. Text alignment follows the block's "text alignment" setting.
const FIELD = "bs-field peer h-12 w-full [text-align:inherit] rounded-lg border px-3 pb-1 pt-5 text-sm text-foreground placeholder-transparent transition-colors hover:border-border focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15";
const AREA = "bs-field peer min-h-32 w-full [text-align:inherit] rounded-lg border px-3 pb-2 pt-6 text-sm text-foreground placeholder-transparent transition-colors hover:border-border focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15";
const FLOAT_LABEL = "pointer-events-none absolute left-3 top-3 origin-left text-sm text-muted-foreground transition-all peer-focus:top-1.5 peer-focus:text-[11px] peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:text-[11px]";
const LABEL_TOP = "pointer-events-none absolute left-3 top-1.5 text-[11px] text-muted-foreground";

/** The live contact form: posts to the store, shows a thank-you on success and a plain error otherwise. */
export function ContactFormClient({ options }: { options: ContactFormOptions }) {
  const uid = useId();
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const choices = options.dropdownOptions.split(",").map((c) => c.trim()).filter(Boolean);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/storefront/forms/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formName: options.formName,
          recipientEmail: options.recipientEmail,
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone") ?? undefined,
          choice: data.get("choice") ?? undefined,
          message: data.get("message") ?? undefined,
          honeypot: data.get("website") ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not send your message. Please try again.");
      }
      form.reset();
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message. Please try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p role="status" className="mt-4 rounded-lg border border-[color-mix(in_srgb,currentColor_20%,transparent)] p-4 text-sm">
        {options.successMessage}
      </p>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-3" noValidate={false} style={{ textAlign: options.fieldAlign ?? "left" }}>
      <div className="relative">
        <input id={`${uid}-name`} name="name" required maxLength={120} autoComplete="name" placeholder=" " className={FIELD} />
        <label htmlFor={`${uid}-name`} className={FLOAT_LABEL}>Name *</label>
      </div>
      <div className="relative">
        <input id={`${uid}-email`} name="email" type="email" required maxLength={254} autoComplete="email" placeholder=" " className={FIELD} />
        <label htmlFor={`${uid}-email`} className={FLOAT_LABEL}>Email *</label>
      </div>
      {options.showPhone ? (
        <div className="relative">
          <input id={`${uid}-phone`} name="phone" type="tel" inputMode="tel" required={options.phoneRequired} maxLength={20} autoComplete="tel" placeholder=" " className={FIELD} />
          <label htmlFor={`${uid}-phone`} className={FLOAT_LABEL}>Phone number{options.phoneRequired ? " *" : ""}</label>
        </div>
      ) : null}
      {options.showDropdown && choices.length > 0 ? (
        <div className="relative">
          <select id={`${uid}-choice`} name="choice" className={`${FIELD} appearance-none pr-8`} defaultValue={choices[0]}>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label htmlFor={`${uid}-choice`} className={LABEL_TOP}>{options.dropdownLabel}</label>
          <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      ) : null}
      {options.showMessage ? (
        <div className="relative">
          <textarea id={`${uid}-message`} name="message" rows={5} required={options.messageRequired} maxLength={4000} placeholder=" " className={AREA} />
          <label htmlFor={`${uid}-message`} className={FLOAT_LABEL}>{options.messageLabel}{options.messageRequired ? " *" : ""}</label>
        </div>
      ) : null}
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={state === "sending"} className={`bsb-btn bsb-btn-primary disabled:opacity-60 ${options.fieldAlign === "center" ? "justify-self-center" : options.fieldAlign === "right" ? "justify-self-end" : "justify-self-start"}`}>
        {state === "sending" ? "Sending..." : options.submitLabel}
      </button>
      {options.consentText ? <p className="text-xs opacity-70">{options.consentText}</p> : null}
    </form>
  );
}
