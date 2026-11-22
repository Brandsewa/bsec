import { connection } from "next/server";
import { protectedResourceResponse } from "@/server/ai-http.ts";

// RFC 9728 protected resource metadata for the AI access endpoint (ADR-050). Served on the platform root host only.
export async function GET(req: Request): Promise<Response> {
  await connection();
  return protectedResourceResponse(req);
}
