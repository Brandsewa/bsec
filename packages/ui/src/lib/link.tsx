import { createContext, createElement, useContext, type ComponentType, type ReactNode } from "react";

/**
 * The ported Supabase pieces import next/link; ours are router-agnostic (PLAN §12 adjustment).
 * The admin app provides a TanStack Router link; anything else falls back to <a>.
 */
export interface UiLinkProps {
  href: string;
  className?: string | undefined;
  children: ReactNode;
  "aria-current"?: "page" | undefined;
}

const DefaultLink: ComponentType<UiLinkProps> = ({ href, ...rest }) => <a href={href} {...rest} />;

const LinkContext = createContext<ComponentType<UiLinkProps>>(DefaultLink);

export function UiLinkProvider({ component, children }: { component: ComponentType<UiLinkProps>; children: ReactNode }) {
  return <LinkContext value={component}>{children}</LinkContext>;
}

export function UiLink(props: UiLinkProps) {
  // The provided component is stable for the app lifetime; createElement avoids a false "component created during render".
  return createElement(useContext(LinkContext), props);
}
