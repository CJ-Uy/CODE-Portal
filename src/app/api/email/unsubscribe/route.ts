import { applyTokenOptOut } from "@/db/repositories/email-member";
import { emailConfigFromEnv, emailDbFromEnv } from "@/server/email/db";
import { verifyUnsubscribeToken } from "@/server/email/unsubscribe-token";
import { isFeatureEnabled } from "@/server/features";

// RFC 8058 one-click: mail providers POST here from their own servers, so there is no
// same-origin check. The HMAC token is the only credential and is scoped to one member
// and one optional category.
export async function POST(request: Request) {
	if (!isFeatureEnabled("email")) return new Response(null, { status: 404 });
	const token = new URL(request.url).searchParams.get("t") ?? "";
	const payload = await verifyUnsubscribeToken(emailConfigFromEnv().unsubscribeSecret, token);
	if (!payload) return new Response("Invalid link.", { status: 400 });
	await applyTokenOptOut(emailDbFromEnv(), payload, true);
	return new Response("Unsubscribed.", { status: 200 });
}

// GET never writes, because link scanners prefetch URLs. Send people to the confirm page.
export async function GET(request: Request) {
	const url = new URL(request.url);
	return Response.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(url.searchParams.get("t") ?? "")}`, url.origin), 303);
}
