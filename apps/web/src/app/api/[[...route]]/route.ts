import { connection } from "next/server";
import { api } from "@/server/api.ts";

// All /api traffic is request-time: it reads the request and the database.
async function handle(req: Request): Promise<Response> {
  await connection();
  return api.fetch(req);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
// Without this Next.js answers CORS preflights itself with a bare 204, so the admin SPA (a different
// origin) could never call the API. The Hono app's cors() middleware must see them.
export const OPTIONS = handle;
