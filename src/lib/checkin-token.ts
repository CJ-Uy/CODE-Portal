// Short-lived signed event check-in token. HMAC-SHA256 over
// "memberId:eventId:expiry", keyed by a purpose-labeled derivation of
// AUTH_SECRET ("checkin:" + secret) so the raw session-signing key is never
// reused directly. Not stored anywhere — verified server-side on scan.
//
// Token shape: `code:checkin:<base64url(payload)>.<base64url(hmac)>`.

const PREFIX = "code:checkin:";
const TTL_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

function bytesToB64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToString(value: string): string {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	return atob(padded);
}

async function sign(secret: string, payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(`checkin:${secret}`),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
	return bytesToB64Url(new Uint8Array(signature));
}

// Constant-time string comparison to avoid leaking signature bytes via timing.
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export async function createCheckinToken(
	secret: string,
	input: { memberId: string; eventId: string },
	now: number = Date.now(),
): Promise<string> {
	const expiry = now + TTL_MS;
	const payload = `${input.memberId}:${input.eventId}:${expiry}`;
	const signature = await sign(secret, payload);
	const payloadB64 = bytesToB64Url(encoder.encode(payload));
	return `${PREFIX}${payloadB64}.${signature}`;
}

export async function verifyCheckinToken(
	secret: string,
	token: string,
	eventId: string,
	now: number = Date.now(),
): Promise<{ memberId: string } | null> {
	if (!token.startsWith(PREFIX)) return null;
	const [payloadB64, signature] = token.slice(PREFIX.length).split(".");
	if (!payloadB64 || !signature) return null;
	let payload: string;
	try {
		payload = b64UrlToString(payloadB64);
	} catch {
		return null;
	}
	const parts = payload.split(":");
	if (parts.length !== 3) return null;
	const [memberId, tokenEventId, expiryRaw] = parts;
	if (tokenEventId !== eventId) return null;
	const expiry = Number(expiryRaw);
	if (!Number.isFinite(expiry) || expiry < now) return null;
	const expected = await sign(secret, payload);
	if (!timingSafeEqual(expected, signature)) return null;
	return { memberId };
}

export function isCheckinToken(value: string): boolean {
	return value.startsWith(PREFIX);
}
