import { z } from "zod";

/** Body of the saved-address endpoints (create and edit). */
export const AddressBody = z.object({
  name: z.string().trim().min(1, "Enter the recipient name").max(120),
  phone: z.string().regex(/^[6-9][0-9]{9}$/, "Enter a valid 10-digit phone number"),
  line1: z.string().trim().min(1, "Enter the address").max(200),
  line2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Enter the city").max(80),
  stateCode: z.string().trim().min(1, "Enter the state").max(80),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit pincode"),
  type: z.enum(["home", "work", "other"]).default("home"),
  isDefault: z.boolean().default(false),
});
