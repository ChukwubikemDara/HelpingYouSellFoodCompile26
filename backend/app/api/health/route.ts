export const runtime = "nodejs";
export function GET() {
  // Liveness only: this does not assert DynamoDB connectivity.
  return Response.json({ status: "ok" });
}
