import { readFile } from "node:fs/promises";
import { join } from "node:path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/")) return Response.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  try { return new Response(await readFile(join(process.cwd(), "public", "index.html")), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }); }
  catch { return new Response("Build the web app first: run pnpm build:web from backend/.", { status: 503 }); }
}
