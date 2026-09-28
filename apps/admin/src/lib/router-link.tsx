import { Link } from "@tanstack/react-router";
import type { UiLinkProps } from "@bs/ui";

/** Plugs TanStack Router navigation (with hover preloading) into @bs/ui links. */
export function RouterLink({ href, ...rest }: UiLinkProps) {
  return <Link to={href} {...rest} />;
}
