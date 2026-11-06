import { brandLogoPair, getPublicPlatformBrand } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/** The saved platform logo for the website header and footer (full logos only), or null until a brand is saved. */
export async function platformLogoPair() {
  const brand = await getPublicPlatformBrand(server().rt).catch(() => null);
  return brand?.explicit ? brandLogoPair(brand.tokens) : null;
}
