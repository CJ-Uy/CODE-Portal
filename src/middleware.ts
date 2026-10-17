import { NextResponse, type NextRequest } from "next/server";
import { PORTAL_PATH_HEADER } from "@/server/auth/access";

// Edge middleware, not proxy.ts: OpenNext rejects Node.js middleware.
// Hands the requested portal path to server components, so a signed-out visitor
// can be sent to /signin?next=<path> instead of losing the deep link.
export function middleware(request: NextRequest) {
	const headers = new Headers(request.headers);
	headers.set(PORTAL_PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
	return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/portal/:path*" };
