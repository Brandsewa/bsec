"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { ContactFormOptions } from "@bs/blocks";

/**
 * Loads the contact form in the browser after the page is up, so its code is not part of every page's JavaScript. The placeholder keeps
 * the form's space while it loads.
 */
export function ContactFormLazy({ options }: { options: ContactFormOptions }) {
  const [Form, setForm] = useState<ComponentType<{ options: ContactFormOptions }> | null>(null);
  useEffect(() => {
    void import("./ContactFormClient.tsx").then((m) => setForm(() => m.ContactFormClient));
  }, []);
  return Form ? <Form options={options} /> : <div aria-hidden className="bsb-cf-skel" />;
}
