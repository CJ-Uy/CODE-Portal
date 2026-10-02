const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
	try {
		const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
}

const key = (secret: string) =>
	crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/** `base64url(memberId:categoryId).base64url(HMAC-SHA256)`. Scoped to one member and one category. */
export async function signUnsubscribeToken(secret: string, memberId: string, categoryId: string): Promise<string> {
	const payload = encoder.encode(`${memberId}:${categoryId}`);
	const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), payload));
	return `${toBase64Url(payload)}.${toBase64Url(signature)}`;
}

export async function verifyUnsubscribeToken(secret: string, token: string): Promise<{ memberId: string; categoryId: string } | null> {
	const [payloadPart, signaturePart, extra] = token.split(".");
	if (!payloadPart || !signaturePart || extra !== undefined) return null;
	const payload = fromBase64Url(payloadPart);
	const signature = fromBase64Url(signaturePart);
	if (!payload || !signature) return null;
	// crypto.subtle.verify compares in constant time.
	const valid = await crypto.subtle.verify("HMAC", await key(secret), signature, payload);
	if (!valid) return null;
	const [memberId, categoryId, rest] = new TextDecoder().decode(payload).split(":");
	if (!memberId || !categoryId || rest !== undefined) return null;
	return { memberId, categoryId };
}
