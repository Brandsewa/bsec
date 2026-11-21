import { connection } from "next/server";
import { authorizationServerResponse } from "@/server/ai-http.ts";

// RFC 8414 authorization server metadata for AI apps (ADR-050). Served on the platform root host only.
export async function GET(req: Request): Promise<Response> {
  await connection();
  return authorizationServerResponse(req);
}
