"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { ContactFormOptions } from "@bs/blocks";

const FIELD = "w-full [text-align:inherit] rounded-lg border border-[color-mix(in_srgb,currentColor_20%,transparent)] bg-transparent px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,currentColor_30%,transparent)]";

/** The live contact form: posts to the store, shows a thank-you on success and a plain error otherwise. */
export function ContactFormClient({ options }: { options: ContactFormOptions }) {
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
      <label className="grid gap-1 text-sm font-medium">
        Name
        <input name="name" required maxLength={120} autoComplete="name" className={FIELD} />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Email
        <input name="email" type="email" required maxLength={254} autoComplete="email" className={FIELD} />
      </label>
      {options.showPhone ? (
        <label className="grid gap-1 text-sm font-medium">
          Phone number{options.phoneRequired ? "" : " (optional)"}
          <input name="phone" type="tel" inputMode="tel" required={options.phoneRequired} maxLength={20} autoComplete="tel" className={FIELD} />
        </label>
      ) : null}
      {options.showDropdown && choices.length > 0 ? (
        <label className="grid gap-1 text-sm font-medium">
          {options.dropdownLabel}
          <select name="choice" className={FIELD} defaultValue={choices[0]}>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {options.showMessage ? (
        <label className="grid gap-1 text-sm font-medium">
          {options.messageLabel}
          <textarea name="message" rows={5} required={options.messageRequired} maxLength={4000} className={FIELD} />
        </label>
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
