import { createContext, useContext } from "react";
import type { PlatformRole, PlatformUser } from "./auth.ts";

export const UserContext = createContext<PlatformUser | null>(null);

const RANK: Record<PlatformRole, number> = { platform_support: 1, platform_admin: 2, platform_owner: 3 };

/** The signed-in staff member (pages are only rendered when there is one). */
export function useStaff(): PlatformUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useStaff must be used inside the authenticated layout");
  return user;
}

/** True when the signed-in staff member has at least the given role. The server enforces this too; the UI just hides what would be refused. */
export function useHasRole(min: PlatformRole): boolean {
  return RANK[useStaff().role] >= RANK[min];
}
