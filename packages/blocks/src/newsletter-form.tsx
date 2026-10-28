import type { CSSProperties, ReactNode } from "react";

/**
 * The one newsletter form: footer, Newsletter block, blog archive and blog post all use it. It posts to the store's newsletter
 * (the Leads list); the storefront layout's small script sends it in the background and shows the reply under the form, so the
 * shopper stays on the page. Without JavaScript it is a normal form post.
 */
export function NewsletterForm({
  source,
  placeholder = "Your email address",
  buttonLabel = "Subscribe",
  className = "bsb-form",
  style,
}: {
  /** Where the sign-up came from, shown in Leads (omit for the default). */
  source?: string | undefined;
  placeholder?: string | undefined;
  buttonLabel?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}): ReactNode {
  return (
    <form className={className} action="/api/storefront/newsletter/subscribe" method="post" style={style}>
      {source ? <input type="hidden" name="source" value={source} /> : null}
      <input className="bsb-input" type="email" name="email" required placeholder={placeholder} aria-label="Email address" />
      <button className="bsb-btn bsb-btn-primary bsb-btn-sm" type="submit">
        {buttonLabel}
      </button>
    </form>
  );
}
