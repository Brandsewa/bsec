import { getClientIp } from "@bs/domain";

/**
 * Re-exports the canonical getClientIp from @bs/domain.
 * Never trust client-forged headers; takes the trusted reverse proxy hop.
 */
export const clientIp = getClientIp;
export { getClientIp };

