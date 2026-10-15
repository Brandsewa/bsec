"use client";

import React, { useId, useState } from "react";
import { PLACEHOLDER_IMAGE_URL } from "@/lib/placeholder.ts";
import { paragraphs } from "@/lib/description-text.ts";

/** Plain text with paragraphs on blank lines and "- " lines as bullet points. Rendered as text, never as HTML. */
function RichPlain({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      {paragraphs(text).map((block, i) => {
        const lines = block.split(/\r?\n/);
        if (lines.every((l) => l.trim().startsWith("- "))) {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{l.trim().slice(2)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {block}
          </p>
        );
      })}
    </div>
  );
}

/** Product page, second section: tabs on one side (the product's description, then shipping and returns) and a picture on the other. */
export function ProductInfoTabs({
  descriptionLabel,
  shippingLabel,
  descriptionText,
  shippingContent,
  imageUrl,
  imageAlt,
  imageSide = "right",
}: {
  descriptionLabel: string;
  shippingLabel: string;
  descriptionText: string;
  shippingContent: string;
  imageUrl?: string | undefined;
  imageAlt: string;
  imageSide?: "right" | "left" | undefined;
}) {
  const id = useId();
  const tabs = [
    { key: "description", label: descriptionLabel, body: descriptionText || "No description has been added for this product yet." },
    { key: "shipping", label: shippingLabel, body: shippingContent },
  ].filter((t) => t.body.trim() !== "");
  const [active, setActive] = useState(0);
  const current = tabs[Math.min(active, tabs.length - 1)];
  if (!current) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" aria-label="Product information">
      <div className={`grid items-start gap-8 lg:grid-cols-2 lg:gap-16 ${imageSide === "left" ? "" : ""}`}>
        <div className={imageSide === "left" ? "lg:order-2" : undefined}>
          <div role="tablist" aria-label="Product information" className="flex gap-6 border-b border-border">
            {tabs.map((t, i) => (
              <button
                key={t.key}
                id={`${id}-tab-${i}`}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-controls={`${id}-panel`}
                tabIndex={i === active ? 0 : -1}
                onClick={() => setActive(i)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                    setActive(next);
                    document.getElementById(`${id}-tab-${next}`)?.focus();
                  }
                }}
                className={`-mb-px border-b-2 pb-3 text-sm font-semibold transition-colors ${i === active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${Math.min(active, tabs.length - 1)}`} className="pt-5">
            <RichPlain text={current.body} />
          </div>
        </div>

        <div className={`overflow-hidden rounded-2xl bg-muted ${imageSide === "left" ? "lg:order-1" : ""}`} style={{ aspectRatio: "4 / 3" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl ?? PLACEHOLDER_IMAGE_URL} alt={imageUrl ? imageAlt : ""} loading="lazy" className="h-full w-full object-cover" />
        </div>
      </div>
    </section>
  );
}
