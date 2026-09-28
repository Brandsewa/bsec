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
