import { Link } from "@tanstack/react-router";
import type { UiLinkProps } from "@bs/ui";

/** Plugs TanStack Router navigation into @bs/ui links. */
export function RouterLink({ href, ...rest }: UiLinkProps) {
  return <Link to={href} {...rest} />;
}
