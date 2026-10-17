import React from "react";
import type { StorefrontCustomField } from "@bs/domain";

/**
 * One custom field of the product (ADR-034), drawn by the product page for the theme's "Custom field" block. Values were
 * validated when saved; rich text is cleaned again on the server before it gets here. Draws nothing without a value.
 */
export function ProductCustomField({ field, showLabel, label }: { field: StorefrontCustomField | undefined; showLabel: boolean; label: string }) {
  if (!field) return null;
  const title = label.trim() || field.name;

  let body: React.ReactNode;
  switch (field.type) {
    case "rich_text":
      body = <div className="bs-custom-field-rich" dangerouslySetInnerHTML={{ __html: String(field.value) }} />;
      break;
    case "image":
      body = field.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- storefront media is served from the store's own bucket
        <img src={field.imageUrl} alt={field.imageAlt ?? field.name} loading="lazy" className="h-auto max-w-full rounded-lg" />
      ) : null;
      break;
    case "multi_select":
      body = (
        <ul className="flex flex-wrap gap-2">
          {(field.value as string[]).map((v) => (
            <li key={v} className="rounded-full border border-current/20 px-3 py-1 text-sm">
              {v}
            </li>
          ))}
        </ul>
      );
      break;
    case "boolean":
      body = <p>{field.value === true ? "Yes" : "No"}</p>;
      break;
    case "number":
      body = <p>{new Intl.NumberFormat("en-IN").format(Number(field.value))}</p>;
      break;
    default:
      body = <p className="whitespace-pre-line">{String(field.value)}</p>;
  }
  if (body === null) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8" data-custom-field={field.key}>
      {showLabel ? <h2 className="mb-2 text-lg font-semibold">{title}</h2> : null}
      {body}
    </section>
  );
}
