import { handle, json } from "@/lib/http";
import type { HealthResponse } from "@/lib/contract";

export const dynamic = "force-dynamic";

export const GET = handle(async () => json<HealthResponse>({ ok: true }));

// Methods this route does not support: 404 in the error envelope (lib/http unknownRoute).
export { unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";
