/**
 * CORS for the consumer app (contract: "CORS is enabled on the backend for the
 * consumer client").
 *
 * Only consumer and customer-auth endpoints get CORS headers, and only for
 * the methods the consumer client uses. Customers authenticate with a bearer
 * token, never a cookie, so `Access-Control-Allow-Origin: *` without
 * credentials is safe. Merchant endpoints (session cookie) stay same-origin:
 * no CORS headers, so browsers block cross-origin calls to them.
 *
 * It also answers a malformed percent-encoded /api path with the contract's
 * 404 envelope instead of Next.js's HTML error page.
 *
 * Self-contained on purpose: middleware runs in the edge runtime and must not
 * import the store or other Node-only modules.
 */
import { NextResponse, type NextRequest } from "next/server";

/** Path pattern -> methods the consumer client may call cross-origin. More specific patterns first. */
const CONSUMER_ROUTES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/^\/api\/health$/, ["GET"]],
  [/^\/api\/auth\/customer\/(signup|signin)$/, ["POST"]],
  [/^\/api\/customers\/me$/, ["GET"]],
  [/^\/api\/customers\/me\/push-token$/, ["POST"]],
  [/^\/api\/deals$/, ["GET"]],
  [/^\/api\/deals\/[^/]+$/, ["GET"]],
  [/^\/api\/reservations$/, ["GET", "POST"]],
  [/^\/api\/reservations\/redeem$/, []], // merchant only
  [/^\/api\/reservations\/[^/]+$/, ["GET"]],
  [/^\/api\/reservations\/[^/]+\/(cancel|confirm-pickup)$/, ["POST"]],
  [/^\/api\/follows$/, ["GET", "POST"]],
  [/^\/api\/follows\/[^/]+$/, ["DELETE"]],
  [/^\/api\/notifications$/, ["GET"]],
  [/^\/api\/notifications\/[^/]+\/read$/, ["POST"]],
];

const ALLOWED_HEADERS = "Authorization, Content-Type";
const MAX_AGE_SECONDS = "600";

/** Methods the consumer client may call on this path cross-origin, or null if the path is not a consumer route. */
export function consumerMethods(pathname: string): readonly string[] | null {
  for (const [pattern, methods] of CONSUMER_ROUTES) {
    if (pattern.test(pathname)) return methods.length > 0 ? methods : null;
  }
  return null;
}

function isDecodable(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return true;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest): NextResponse {
  // A malformed percent-encoding would get Next.js's HTML 400 page; answer
  // with the contract's error envelope, like any other unknown /api path.
  if (!isDecodable(request.nextUrl.pathname)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found." } },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const methods = consumerMethods(request.nextUrl.pathname);
  if (!methods) return NextResponse.next();

  const preflightMethod = request.headers.get("access-control-request-method");
  if (request.method === "OPTIONS" && preflightMethod) {
    if (!methods.includes(preflightMethod.toUpperCase())) return NextResponse.next();
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": methods.join(", "),
        "Access-Control-Allow-Headers": ALLOWED_HEADERS,
        "Access-Control-Max-Age": MAX_AGE_SECONDS,
      },
    });
  }

  if (!methods.includes(request.method)) return NextResponse.next();
  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
