/** Any other /api path: the contract error envelope with 404 NOT_FOUND instead of an HTML page. */
export { unknownRoute as GET, unknownRoute as POST, unknownRoute as PUT, unknownRoute as PATCH, unknownRoute as DELETE } from "@/lib/http";

export const dynamic = "force-dynamic";
